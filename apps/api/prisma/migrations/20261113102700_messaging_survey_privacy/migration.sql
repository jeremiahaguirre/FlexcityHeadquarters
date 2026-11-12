-- CreateEnum
CREATE TYPE "SurveyBreakdown" AS ENUM ('NONE', 'DEPARTMENT', 'POSITION');

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "historyFrom" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "MessageAttachment" DROP COLUMN "sha256",
ADD COLUMN     "nameAuthTag" BYTEA,
ADD COLUMN     "nameCiphertext" BYTEA,
ADD COLUMN     "nameIv" BYTEA,
ALTER COLUMN "fileName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "breakdown" "SurveyBreakdown" NOT NULL DEFAULT 'DEPARTMENT';


-- People who joined a conversation well after it was made see only what was sent from then on.
UPDATE "ConversationMember" cm SET "historyFrom" = cm."joinedAt"
  FROM "Conversation" c WHERE c.id = cm."conversationId" AND cm."joinedAt" > c."createdAt" + interval '1 minute';

-- Existing surveys keep their department breakdown only; the position tag on their answers goes.
UPDATE "SurveyResponse" SET "positionId" = NULL WHERE "positionId" IS NOT NULL;
