-- A bank transmission is recorded before the upload starts (SENDING), then marked SENT or FAILED, so a
-- pay run can't be voided while its deposit file is on its way to the bank.
ALTER TYPE "TransmissionStatus" ADD VALUE IF NOT EXISTS 'SENDING';
