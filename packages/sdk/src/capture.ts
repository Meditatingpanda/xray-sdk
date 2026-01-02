import { Candidate, CapturePolicy, Outcome } from "./types";

export type CaptureResult = {
    capturedCandidates: Candidate[];
    capturedOutcomes: Outcome[];
    histogram: Record<string, number>;
};

function defaultPolicy(): CapturePolicy {
    return {
        mode: "THRESHOLD",
        threshold: 200,
        topK: 50,
        sampleN: 50,
        includeOutcomes: true,
        includeRejected: true
    };
}

export function applyCapturePolicy(
    candidatesIn: Candidate[],
    outcomes: Outcome[],
    policy?: Partial<CapturePolicy>
): CaptureResult {
    const p: CapturePolicy = { ...defaultPolicy(), ...(policy ?? {}) };

    // histogram of rejection reasons always computed (cheap)
    const histogram: Record<string, number> = {};
    for (const o of outcomes) {
        if (o.outcome === "rejected") {
            const k = o.reasonCode ?? "UNKNOWN";
            histogram[k] = (histogram[k] ?? 0) + 1;
        }
    }

    const n = candidatesIn.length;

    const mode =
        p.mode === "THRESHOLD"
            ? (n <= (p.threshold ?? 200) ? "FULL" : "TOP_K")
            : p.mode;

    let capturedCandidates: Candidate[] = [];
    if (mode === "FULL") {
        capturedCandidates = candidatesIn;
    } else if (mode === "TOP_K") {
        const k = Math.max(1, p.topK ?? 50);
        capturedCandidates = [...candidatesIn]
            .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
            .slice(0, k);
    } else if (mode === "SAMPLE") {
        const k = Math.min(Math.max(1, p.sampleN ?? 50), n);
        // reservoir-ish quick sample
        const arr = [...candidatesIn];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        capturedCandidates = arr.slice(0, k);
    } else {
        // SUMMARY_ONLY
        capturedCandidates = [];
    }

    const capturedKey = new Set(capturedCandidates.map(c => `${c.candidateType}:${c.candidateId}`));

    // Outcomes policy:
    // - Always keep "selected"
    // - Optionally keep accepted/rejected for captured candidates
    const capturedOutcomes: Outcome[] = [];
    for (const o of outcomes) {
        const key = `${o.candidateType}:${o.candidateId}`;
        if (o.outcome === "selected") {
            capturedOutcomes.push(o);
            continue;
        }
        if (p.includeOutcomes === false) continue;
        if (!capturedKey.has(key)) continue;
        if (o.outcome === "rejected" && p.includeRejected === false) continue;
        capturedOutcomes.push(o);
    }

    return { capturedCandidates, capturedOutcomes, histogram };
}
