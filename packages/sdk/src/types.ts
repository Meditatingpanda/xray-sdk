export type RunStatus = "running" | "success" | "error";
export type StepStatus = "running" | "success" | "error";
export type CandidateOutcome = "accepted" | "rejected" | "selected";

export type Candidate = {
    candidateId: string;
    candidateType: string;
    rank?: number;
    score?: number;
    payload?: any;
    meta?: Record<string, any>;
};

export type Outcome = {
    candidateId: string;
    candidateType: string;
    outcome: CandidateOutcome;
    reasonCode?: string;
    reasonDetail?: any;
    reasoningText?: string;
};

export type CaptureMode = "FULL" | "TOP_K" | "SAMPLE" | "SUMMARY_ONLY" | "THRESHOLD";

export type CapturePolicy = {
    mode: CaptureMode;
    topK?: number;              // for TOP_K
    sampleN?: number;           // for SAMPLE
    threshold?: number;         // for THRESHOLD
    includeOutcomes?: boolean;  // if false, only store histogram + selected
    includeRejected?: boolean;  // if true, store rejected outcomes for captured cands
};

export type XRayConfig = {
    endpoint: string; // e.g. http://localhost:4319
    apiKey: string;

    timeoutMs?: number;         // network timeout
    flushIntervalMs?: number;   // background flush cadence
    maxQueue?: number;          // drop oldest beyond this
    onError?: (e: unknown) => void;
};

export type RunStart = {
    traceId: string;
    pipeline: string;
    pipelineVersion?: string;
    input?: any;
    tags?: Record<string, any>;
    meta?: Record<string, any>;
};

export type StepStart = {
    name: string;
    type: string;
    input?: any;
    meta?: Record<string, any>;
    capturePolicy?: Partial<CapturePolicy>;
};
