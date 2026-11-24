-- What an identity provider proved at single sign-on, kept on the hand-off code and the session, so
-- the passkey rule for passkey-mandatory roles (ASVS 6.8.4) is applied on every request.
-- Additive: older code ignores both columns.
ALTER TABLE "AuthToken" ADD COLUMN "ssoStrength" TEXT;

ALTER TABLE "RefreshToken" ADD COLUMN "ssoStrength" TEXT;
