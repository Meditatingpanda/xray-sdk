import { v4 as uuid } from "uuid";
import { XRayClient } from "./client";
import { als, getCtx } from "./context";
import { applyCapturePolicy } from "./capture";
import { Candidate, Outcome, RunStart, StepStart, XRayConfig } from "./types";

export * from "./types";

export class XRay {
    private client: XRayClient;

    constructor(cfg: { endpoint: string; apiKey?: string }) {
        this.client = new XRayClient(cfg as XRayConfig);
    }

    startRun(run: RunStart) {
        const runId = uuid();
        const now = new Date().toISOString();
        this.client.enqueue("/v1/runs", {
            runId,
            traceId: run.traceId,
            pipeline: run.pipeline,
            pipelineVersion: run.pipelineVersion,
            status: "running",
            startedAt: now,
            input: run.input,
            tags: run.tags ?? {},
            meta: run.meta ?? {}
        });

        const runHandle = new XRayRun(this.client, runId, run.traceId);
        return runHandle;
    }
    async flush() {
        await this.client.flush();
    }

    shutdown() {
        this.client.shutdown();
    }
}

export class XRayRun {
    constructor(
        private client: XRayClient,
        public runId: string,
        public traceId: string
    ) { }

    async withContext<T>(fn: () => Promise<T>): Promise<T> {
        return await als.run({ runId: this.runId, traceId: this.traceId }, fn);
    }

    step(s: StepStart) {
        const stepId = uuid();
        const startedAt = new Date().toISOString();
        const stepHandle = new XRayStep(this.client, {
            stepId,
            runId: this.runId,
            name: s.name,
            type: s.type,
            startedAt,
            input: s.input,
            meta: s.meta,
            capturePolicy: s.capturePolicy
        });

        // "running" ingest early so you can see partial runs
        stepHandle.ingestRunning();
        return stepHandle;
    }

    endSuccess(output?: any) {
        const endedAt = new Date().toISOString();
        this.client.enqueue("/v1/runs", {
            runId: this.runId,
            traceId: this.traceId,
            pipeline: "unknown", // overwritten by upsert only if provided; best to pass in startRun
            status: "success",
            startedAt: endedAt,
            endedAt,
            output
        });
    }

    endError(error: any) {
        const endedAt = new Date().toISOString();
        this.client.enqueue("/v1/runs", {
            runId: this.runId,
            traceId: this.traceId,
            pipeline: "unknown",
            status: "error",
            startedAt: endedAt,
            endedAt,
            error: normalizeErr(error)
        });
    }
}

function normalizeErr(e: any) {
    if (!e) return { message: "Unknown error" };
    return {
        message: e.message ?? String(e),
        code: e.code,
        stack: e.stack
    };
}

type StepInit = {
    stepId: string;
    runId: string;
    name: string;
    type: string;
    startedAt: string;
    input?: any;
    meta?: Record<string, any>;
    capturePolicy?: any;
};

export class XRayStep {
    private candidatesIn: Candidate[] = [];
    private outcomes: Outcome[] = [];
    private reasoning: any;
    private output: any;
    private status: "running" | "success" | "error" = "running";
    private endedAt?: string;

    constructor(private client: XRayClient, private init: StepInit) { }

    // Minimal instrumentation: call at start so UI can show "running"
    ingestRunning() {
        this.client.enqueue("/v1/steps", {
            stepId: this.init.stepId,
            runId: this.init.runId,
            name: this.init.name,
            type: this.init.type,
            status: "running",
            startedAt: this.init.startedAt,
            input: this.init.input,
            meta: this.init.meta ?? {},
            capturePolicy: this.init.capturePolicy ?? {},
            metrics: {
                candidatesIn: 0,
                candidatesCaptured: 0,
                acceptedCount: 0,
                rejectedCount: 0,
                selectedCount: 0,
                rejectionRate: 0
            }
        });
    }

    addCandidates(cands: Candidate[]) {
        this.candidatesIn.push(...cands);
    }

    // Store explicit reject/accept with reasons
    reject(candidateId: string, candidateType: string, reasonCode: string, reasonDetail?: any, reasoningText?: string) {
        this.outcomes.push({ candidateId, candidateType, outcome: "rejected", reasonCode, reasonDetail, reasoningText });
    }

    accept(candidateId: string, candidateType: string, reasonCode?: string, reasonDetail?: any, reasoningText?: string) {
        this.outcomes.push({ candidateId, candidateType, outcome: "accepted", reasonCode, reasonDetail, reasoningText });
    }

    select(candidateId: string, candidateType: string, reasonCode?: string, reasonDetail?: any, reasoningText?: string) {
        this.outcomes.push({ candidateId, candidateType, outcome: "selected", reasonCode, reasonDetail, reasoningText });
    }

    setReasoning(reasoning: any) {
        this.reasoning = reasoning;
    }

    setOutput(output: any) {
        this.output = output;
    }

    async endSuccess() {
        this.status = "success";
        this.endedAt = new Date().toISOString();
        this.ingestFinal();
    }

    async endError(error: any) {
        this.status = "error";
        this.endedAt = new Date().toISOString();
        this.reasoning = { ...(this.reasoning ?? {}), error: normalizeErr(error) };
        this.ingestFinal();
    }

    private ingestFinal() {
        const durationMs =
            new Date(this.endedAt!).getTime() - new Date(this.init.startedAt).getTime();

        const acceptedCount = this.outcomes.filter(o => o.outcome === "accepted").length;
        const rejectedCount = this.outcomes.filter(o => o.outcome === "rejected").length;
        const selectedCount = this.outcomes.filter(o => o.outcome === "selected").length;

        const { capturedCandidates, capturedOutcomes, histogram } = applyCapturePolicy(
            this.candidatesIn,
            this.outcomes,
            this.init.capturePolicy
        );

        const candidatesIn = this.candidatesIn.length;
        const candidatesCaptured = capturedCandidates.length;
        const rejectionRate = candidatesIn > 0 ? rejectedCount / candidatesIn : 0;

        this.client.enqueue("/v1/steps", {
            stepId: this.init.stepId,
            runId: this.init.runId,
            name: this.init.name,
            type: this.init.type,
            status: this.status,
            startedAt: this.init.startedAt,
            endedAt: this.endedAt,
            durationMs,
            input: this.init.input,
            output: this.output,
            reasoning: this.reasoning,
            meta: this.init.meta ?? {},
            capturePolicy: this.init.capturePolicy ?? {},

            metrics: {
                candidatesIn,
                candidatesCaptured,
                acceptedCount,
                rejectedCount,
                selectedCount,
                rejectionRate
            },

            candidates: capturedCandidates,
            outcomes: capturedOutcomes,
            rejectionHistogram: histogram
        });
    }
}

// Convenience: get current runId/traceId if you want implicit context propagation
export function currentRun() {
    return getCtx();
}
