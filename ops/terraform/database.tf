resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.database[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg16"
  family = "postgres16"

  # TLS only (the API also refuses non-TLS URLs in production).
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Server-side slow-query log, matching the API's SLOW_QUERY_MS.
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }
}

# Primary: Multi-AZ (a standby in another zone, automatic failover), encrypted, 35 days of
# point-in-time recovery. The master password is created and rotated by RDS in Secrets Manager.
resource "aws_db_instance" "main" {
  identifier                      = local.name
  engine                          = "postgres"
  engine_version                  = var.db_engine_version
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_allocated_storage_gb
  max_allocated_storage           = var.db_max_storage_gb
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  db_name                         = "flexcity"
  username                        = "fh_owner"
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = aws_kms_key.data.arn
  multi_az                        = true
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.main.name
  ca_cert_identifier              = "rds-ca-rsa2048-g1"
  backup_retention_period         = var.db_backup_retention_days
  backup_window                   = "07:00-08:00" # UTC: 2–4 a.m. Eastern, between evening and morning shifts
  maintenance_window              = "sun:08:00-sun:09:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.environment == "production"
  skip_final_snapshot             = var.environment != "production"
  final_snapshot_identifier       = "${local.name}-final"
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  publicly_accessible             = false
}

# Reports read from here when READ_REPLICA_URL is set (docs/SCALABILITY.md).
resource "aws_db_instance" "replica" {
  count                           = var.db_read_replica ? 1 : 0
  identifier                      = "${local.name}-replica"
  replicate_source_db             = aws_db_instance.main.identifier
  instance_class                  = var.db_instance_class
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.main.name
  ca_cert_identifier              = "rds-ca-rsa2048-g1"
  skip_final_snapshot             = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  publicly_accessible             = false
}

# Disaster recovery: automated backups (snapshots and transaction logs) copied continuously to
# Calgary, so the database can be restored there to any point in the retention window.
resource "aws_db_instance_automated_backups_replication" "dr" {
  provider               = aws.dr
  source_db_instance_arn = aws_db_instance.main.arn
  kms_key_id             = aws_kms_key.data_dr.arn
  retention_period       = 14
}
