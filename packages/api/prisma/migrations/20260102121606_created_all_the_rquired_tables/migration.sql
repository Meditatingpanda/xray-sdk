-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "pipelineVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "tags" JSONB NOT NULL DEFAULT '{}',
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "parentStepId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "reasoning" JSONB,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "capturePolicy" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepCandidate" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateType" TEXT NOT NULL,
    "rank" INTEGER,
    "score" DOUBLE PRECISION,
    "payload" JSONB,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "StepCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateOutcome" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasonCode" TEXT,
    "reasonDetail" JSONB,
    "reasoningText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepMetrics" (
    "stepId" TEXT NOT NULL,
    "candidatesIn" INTEGER NOT NULL DEFAULT 0,
    "candidatesCaptured" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "StepMetrics_pkey" PRIMARY KEY ("stepId")
);

-- CreateIndex
CREATE INDEX "Run_pipeline_startedAt_idx" ON "Run"("pipeline", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Run_traceId_idx" ON "Run"("traceId");

-- CreateIndex
CREATE INDEX "Step_runId_idx" ON "Step"("runId");

-- CreateIndex
CREATE INDEX "Step_name_idx" ON "Step"("name");

-- CreateIndex
CREATE INDEX "Step_type_idx" ON "Step"("type");

-- CreateIndex
CREATE INDEX "StepCandidate_stepId_idx" ON "StepCandidate"("stepId");

-- CreateIndex
CREATE INDEX "StepCandidate_stepId_rank_idx" ON "StepCandidate"("stepId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "StepCandidate_stepId_candidateId_candidateType_key" ON "StepCandidate"("stepId", "candidateId", "candidateType");

-- CreateIndex
CREATE INDEX "CandidateOutcome_stepId_idx" ON "CandidateOutcome"("stepId");

-- CreateIndex
CREATE INDEX "CandidateOutcome_stepId_reasonCode_idx" ON "CandidateOutcome"("stepId", "reasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateOutcome_stepId_candidateId_candidateType_outcome_key" ON "CandidateOutcome"("stepId", "candidateId", "candidateType", "outcome");

-- CreateIndex
CREATE INDEX "StepMetrics_rejectionRate_idx" ON "StepMetrics"("rejectionRate");

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_parentStepId_fkey" FOREIGN KEY ("parentStepId") REFERENCES "Step"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepCandidate" ADD CONSTRAINT "StepCandidate_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateOutcome" ADD CONSTRAINT "CandidateOutcome_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepMetrics" ADD CONSTRAINT "StepMetrics_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
