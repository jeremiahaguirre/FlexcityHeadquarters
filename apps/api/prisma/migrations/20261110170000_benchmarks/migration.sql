-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "benchmarkOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BenchmarkSnapshot" (
    "id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "computedOn" DATE NOT NULL,
    "cities" INTEGER NOT NULL,
    "p25" DOUBLE PRECISION NOT NULL,
    "p50" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BenchmarkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkSnapshot_metric_computedOn_key" ON "BenchmarkSnapshot"("metric", "computedOn");

