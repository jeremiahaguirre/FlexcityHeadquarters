-- Single sign-on counts as the second factor for passkey-mandatory roles only with the identity
-- provider's proof of a phishing-resistant method (ASVS 6.8.4). Without it the session must confirm
-- with a passkey first. Additive: the old code ignores both.
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'SSO_PASSKEY';

ALTER TABLE "RefreshToken" ADD COLUMN "passkeyRequired" BOOLEAN NOT NULL DEFAULT false;
