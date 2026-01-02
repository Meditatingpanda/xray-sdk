import { z } from "zod";

export const CandidateSchema = z.object({
  candidateId: z.string(),
  candidateType: z.string(),
  rank: z.number().int().optional(),
  score: z.number().optional(),
  payload: z.any().optional(),
  meta: z.record(z.string(), z.any()).optional()
});

export const OutcomeSchema = z.object({
  candidateId: z.string(),
  candidateType: z.string(),
  outcome: z.enum(["accepted", "rejected", "selected"]),
  reasonCode: z.string().optional(),
  reasonDetail: z.any().optional(),
  reasoningText: z.string().optional()
});

export const StepIngestSchema = z.object({
  stepId: z.string().uuid(),
  runId: z.string().uuid(),

  parentStepId: z.string().uuid().optional(),
  name: z.string(),
  type: z.string(),
  status: z.enum(["running", "success", "error"]),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().int().optional(),

  input: z.any().optional(),
  output: z.any().optional(),
  reasoning: z.any().optional(),
  meta: z.record(z.string(), z.any()).optional(),

  capturePolicy: z.any().optional(),

  metrics: z.object({
    candidatesIn: z.number().int(),
    candidatesCaptured: z.number().int(),
    acceptedCount: z.number().int(),
    rejectedCount: z.number().int(),
    selectedCount: z.number().int(),
    rejectionRate: z.number()
  }),

  candidates: z.array(CandidateSchema).optional(),
  outcomes: z.array(OutcomeSchema).optional(),

  rejectionHistogram: z.record(z.string(), z.number().int()).optional()
});

export const RunIngestSchema = z.object({
  runId: z.string().uuid(),
  traceId: z.string(),
  pipeline: z.string(),
  pipelineVersion: z.string().optional(),
  status: z.enum(["running", "success", "error"]),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().int().optional(),
  input: z.any().optional(),
  output: z.any().optional(),
  error: z.any().optional(),
  tags: z.record(z.string(), z.any()).optional(),
  meta: z.record(z.string(), z.any()).optional()
});
