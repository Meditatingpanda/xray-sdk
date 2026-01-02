import express from "express";
import prisma from "./prisma";
import { RunIngestSchema, StepIngestSchema } from "./validators.js";

export const router = express.Router();
router.use(express.json({ limit: "2mb" }));

// POST /v1/runs  (upsert run)
router.post("/v1/runs", async (req, res) => {
    const parsed = RunIngestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error);

    const r = parsed.data;

    await prisma.run.upsert({
        where: { id: r.runId },
        create: {
            id: r.runId,
            traceId: r.traceId,
            pipeline: r.pipeline,
            pipelineVersion: r.pipelineVersion,
            status: r.status,
            startedAt: new Date(r.startedAt),
            endedAt: r.endedAt ? new Date(r.endedAt) : null,
            durationMs: r.durationMs ?? null,
            input: r.input ?? null,
            output: r.output ?? null,
            error: r.error ?? null,
            tags: r.tags ?? {},
            meta: r.meta ?? {}
        },
        update: {
            // keep pipeline fields stable; update status/timing/output/error/meta as they arrive
            status: r.status,
            endedAt: r.endedAt ? new Date(r.endedAt) : undefined,
            durationMs: r.durationMs ?? undefined,
            output: r.output ?? undefined,
            error: r.error ?? undefined,
            tags: r.tags ?? undefined,
            meta: r.meta ?? undefined
        }
    });

    res.json({ ok: true });
});

// POST /v1/steps (step + metrics + candidates + outcomes)
router.post("/v1/steps", async (req, res) => {
    const parsed = StepIngestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error);

    const s = parsed.data;

    await prisma.$transaction(async (tx) => {
        // Step upsert
        await tx.step.upsert({
            where: { id: s.stepId },
            create: {
                id: s.stepId,
                runId: s.runId,
                parentStepId: s.parentStepId ?? null,
                name: s.name,
                type: s.type,
                status: s.status,
                startedAt: new Date(s.startedAt),
                endedAt: s.endedAt ? new Date(s.endedAt) : null,
                durationMs: s.durationMs ?? null,
                input: s.input ?? null,
                output: s.output ?? null,
                reasoning: s.reasoning ?? null,
                meta: s.meta ?? {},
                capturePolicy: s.capturePolicy ?? {}
            },
            update: {
                parentStepId: s.parentStepId ?? undefined,
                status: s.status,
                endedAt: s.endedAt ? new Date(s.endedAt) : undefined,
                durationMs: s.durationMs ?? undefined,
                input: s.input ?? undefined,
                output: s.output ?? undefined,
                reasoning: s.reasoning ?? undefined,
                meta: s.meta ?? undefined,
                capturePolicy: s.capturePolicy ?? undefined
            }
        });

        // Metrics upsert
        await tx.stepMetrics.upsert({
            where: { stepId: s.stepId },
            create: {
                stepId: s.stepId,
                candidatesIn: s.metrics.candidatesIn,
                candidatesCaptured: s.metrics.candidatesCaptured,
                acceptedCount: s.metrics.acceptedCount,
                rejectedCount: s.metrics.rejectedCount,
                selectedCount: s.metrics.selectedCount,
                rejectionRate: s.metrics.rejectionRate,
                meta: { rejectionHistogram: s.rejectionHistogram ?? {} }
            },
            update: {
                candidatesIn: s.metrics.candidatesIn,
                candidatesCaptured: s.metrics.candidatesCaptured,
                acceptedCount: s.metrics.acceptedCount,
                rejectedCount: s.metrics.rejectedCount,
                selectedCount: s.metrics.selectedCount,
                rejectionRate: s.metrics.rejectionRate,
                meta: { rejectionHistogram: s.rejectionHistogram ?? {} }
            }
        });

        // Candidates (bulk-ish with upsert loop)
        if (s.candidates?.length) {
            // For truly large writes, you’d batch + use createMany + conflict handling via raw SQL.
            // For TOP_K/SAMPLE sizes (<= 50/200), looping is fine.
            for (const c of s.candidates) {
                await tx.stepCandidate.upsert({
                    where: {
                        stepId_candidateId_candidateType: {
                            stepId: s.stepId,
                            candidateId: c.candidateId,
                            candidateType: c.candidateType
                        }
                    },
                    create: {
                        stepId: s.stepId,
                        candidateId: c.candidateId,
                        candidateType: c.candidateType,
                        rank: c.rank ?? null,
                        score: c.score ?? null,
                        payload: c.payload ?? null,
                        meta: c.meta ?? {}
                    },
                    update: {
                        rank: c.rank ?? undefined,
                        score: c.score ?? undefined,
                        payload: c.payload ?? undefined,
                        meta: c.meta ?? undefined
                    }
                });
            }
        }

        // Outcomes (rejections stored here)
        if (s.outcomes?.length) {
            for (const o of s.outcomes) {
                await tx.candidateOutcome.upsert({
                    where: {
                        stepId_candidateId_candidateType_outcome: {
                            stepId: s.stepId,
                            candidateId: o.candidateId,
                            candidateType: o.candidateType,
                            outcome: o.outcome
                        }
                    },
                    create: {
                        stepId: s.stepId,
                        candidateId: o.candidateId,
                        candidateType: o.candidateType,
                        outcome: o.outcome,
                        reasonCode: o.reasonCode ?? null,
                        reasonDetail: o.reasonDetail ?? null,
                        reasoningText: o.reasoningText ?? null
                    },
                    update: {
                        reasonCode: o.reasonCode ?? undefined,
                        reasonDetail: o.reasonDetail ?? undefined,
                        reasoningText: o.reasoningText ?? undefined
                    }
                });
            }
        }
    });

    res.json({ ok: true });
});

// GET /v1/runs?pipeline=&traceId=&limit=
router.get("/v1/runs", async (req, res) => {
    const { pipeline, traceId, limit = "50" } = req.query as any;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);

    const runs = await prisma.run.findMany({
        where: {
            ...(pipeline ? { pipeline } : {}),
            ...(traceId ? { traceId } : {})
        },
        select: {
            id: true,
            traceId: true,
            pipeline: true,
            pipelineVersion: true,
            status: true,
            startedAt: true,
            endedAt: true,
            durationMs: true,
            tags: true
        },
        orderBy: { startedAt: "desc" },
        take: lim
    });

    res.json({ runs });
});

// GET /v1/runs/:runId (run + steps + metrics)
router.get("/v1/runs/:runId", async (req, res) => {
    const { runId } = req.params;

    const run = await prisma.run.findUnique({
        where: { id: runId }
    });

    if (!run) return res.status(404).json({ error: "Run not found" });

    const steps = await prisma.step.findMany({
        where: { runId },
        orderBy: { startedAt: "asc" },
        include: { metrics: true }
    });

    res.json({ run, steps });
});

// GET /v1/steps/:stepId (step + candidates + outcomes)
router.get("/v1/steps/:stepId", async (req, res) => {
    const { stepId } = req.params;

    const step = await prisma.step.findUnique({
        where: { id: stepId },
        include: {
            metrics: true,
            candidates: { orderBy: [{ rank: "asc" }] },
            outcomes: true
        }
    });

    if (!step) return res.status(404).json({ error: "Step not found" });

    res.json(step);
});

// GET /v1/query/steps?type=&name=&minRejectionRate=0.9&limit=50
router.get("/v1/query/steps", async (req, res) => {
    const { type, name, minRejectionRate = "0.9", limit = "50" } = req.query as any;
    const minRR = Math.max(0, Math.min(parseFloat(minRejectionRate), 1));
    const lim = Math.min(parseInt(limit, 10) || 50, 200);

    const steps = await prisma.step.findMany({
        where: {
            ...(type ? { type } : {}),
            ...(name ? { name } : {}),
            metrics: { rejectionRate: { gte: minRR } }
        },
        select: {
            id: true,
            runId: true,
            name: true,
            type: true,
            startedAt: true,
            metrics: {
                select: {
                    candidatesIn: true,
                    rejectionRate: true
                }
            }
        },
        orderBy: { startedAt: "desc" },
        take: lim
    });

    res.json({ steps });
});
