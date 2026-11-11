-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('DIRECT', 'SHIFT', 'DEPARTMENT', 'GROUP');

-- CreateEnum
CREATE TYPE "MessageReportStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SurveyKind" AS ENUM ('PULSE', 'EXIT');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "messagingSettings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "surveySettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "title" TEXT,
    "directKey" TEXT,
    "shiftKey" TEXT,
    "departmentId" UUID,
    "createdById" UUID,
    "closesAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "lastMessageAt" TIMESTAMPTZ(3),
    "wrappedKey" BYTEA NOT NULL,
    "kekId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "owner" BOOLEAN NOT NULL DEFAULT false,
    "lastReadAt" TIMESTAMPTZ(3),
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "ciphertext" BYTEA,
    "iv" BYTEA,
    "authTag" BYTEA,
    "originalCiphertext" BYTEA,
    "originalIv" BYTEA,
    "originalAuthTag" BYTEA,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "deletedById" UUID,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MessageReportStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMPTZ(3),
    "closedById" UUID,
    "closingNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationAccess" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "reportId" UUID,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Survey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "questions" JSONB NOT NULL,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "departmentIds" UUID[],
    "offboardingId" UUID,
    "subjectUserId" UUID,
    "seriesId" UUID NOT NULL,
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "closesAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "minGroup" INTEGER NOT NULL DEFAULT 5,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyInvite" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "responded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SurveyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "userId" UUID,
    "departmentId" UUID,
    "positionId" UUID,
    "answers" JSONB NOT NULL,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_tenantId_lastMessageAt_idx" ON "Conversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_directKey_key" ON "Conversation"("tenantId", "directKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_shiftKey_key" ON "Conversation"("tenantId", "shiftKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_departmentId_key" ON "Conversation"("tenantId", "departmentId");

-- CreateIndex
CREATE INDEX "ConversationMember_tenantId_userId_idx" ON "ConversationMember"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_authorId_idx" ON "Message"("tenantId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_messageId_key" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "MessageReport_tenantId_status_idx" ON "MessageReport"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MessageReport_conversationId_idx" ON "MessageReport"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationAccess_conversationId_userId_idx" ON "ConversationAccess"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Survey_tenantId_seriesId_idx" ON "Survey"("tenantId", "seriesId");

-- CreateIndex
CREATE INDEX "Survey_tenantId_closesAt_idx" ON "Survey"("tenantId", "closesAt");

-- CreateIndex
CREATE INDEX "SurveyInvite_tenantId_userId_idx" ON "SurveyInvite"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInvite_surveyId_userId_key" ON "SurveyInvite"("surveyId", "userId");

-- CreateIndex
CREATE INDEX "SurveyResponse_surveyId_idx" ON "SurveyResponse"("surveyId");

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

