# Copy to production.tfvars (git-ignored) and fill in.
environment     = "production"
root_domain     = "flexcityhq.example" # placeholder: the real domain once registered
certificate_arn = "arn:aws:acm:ca-central-1:ACCOUNT:certificate/ID"
image_tag       = "GIT_COMMIT"
alarm_email     = "" # an operations mailbox, not a person's

# Plain settings for the API and worker (secrets go in the app secret instead).
app_environment = {
  COMPANY_LEGAL_NAME      = ""
  COMPANY_MAILING_ADDRESS = ""
  COMPANY_CONTACT_EMAIL   = ""
  SECURITY_EMAIL          = ""
  LEADS_ALERT_EMAIL       = ""        # FH's inbox for website enquiry alerts; never shown on the site
  SMS_PROVIDER            = "console" # "twilio" once TWILIO_* are in the app secret
}
