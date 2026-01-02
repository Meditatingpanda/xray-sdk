# XRay System Architecture

## 1. Executive Summary

**XRay** is a specialized observability platform designed for **pipeline-based systems**, such as LLM orchestration chains (RAG apps), data transformation workflows, or multi-step execution jobs.

Unlike generic APM tools (Datadog, New Relic) which focus on CPU/Memory/Requests, XRay focuses on **execution logic observability**:

- What inputs went into this step?
- Which candidates (e.g., retrieved documents) were considered?
- Why were certain candidates rejected?
- What was the reasoning behind the final output?

The system is built as a **Monorepo** containing a TypeScript SDK for instrumentation and a centralised API service for data ingestion and storage.

---
<img width="786" height="601" alt="Screenshot 2026-01-02 at 11 28 59 PM" src="https://github.com/user-attachments/assets/475867c6-f16b-4b16-8ac0-cc6dbf7e0bed" />

## 2. High-Level System Design

The architecture follows a standard **Producer-Consumer** model, decoupled by an ingestion API.

```
graph LR
    subgraph "Client Application"
        UserCode[Your App Code] -->|Instruments| SDK[XRay SDK]
        SDK -->|Buffers & Batches| Network
    end

    subgraph "XRay Backend"
        Network -->|POST /v1/runs, /v1/steps| API[API Service (Express)]
        API -->|Upsert Transactions| DB[(PostgreSQL)]
    end

    subgraph "Data Storage"
        DB --> Run[Run / Trace]
        DB --> Step[Steps]
        DB --> Metric[Metrics & Candidates]
    end
```

### 2.1 Core Components

1.  **XRay SDK (`@xray-sys/sdk`)**:

    - **Role**: Lightweight, non-blocking telemetry emitter.
    - **Behavior**: It does _not_ send every event immediately. Instead, it pushes events to an internal memory queue. A background timer flushes batches to the API asynchronously to minimize impact on the host application's latency.
    - **Capture Policy**: Implements client-side data reduction (sampling) to avoid sending massive payloads (e.g., "only keep top 5 and bottom 5 ranked documents").

2.  **API Service (`@xray-sys/api`)**:

    - **Role**: Ingestion endpoint and data query layer.
    - **Tech Stack**: Node.js, Express, Prisma ORM.
    - **Design Principle**: Heavy use of **Idempotency**. Since networks are unreliable, the SDK may retry sending the same step data. The API uses `upsert` (Insert on Conflict Update) for almost all write operations to ensure data consistency.

3.  **Database**:
    - **Role**: Persistent storage for traces and relational data.
    - **Tech Stack**: PostgreSQL.
    - **Schema**: Optimized for write-heavy loads with frequent updates to existing rows (e.g., updating a step from "running" to "success").

---

## 3. Data Model

The data model captures the lifecycle of a "Run".

### 3.1 Main Entities

- **`Run`**: Represents a single execution of a pipeline.

  - Identified by `runId` (UUID) and `traceId` (Logical ID, e.g., Request ID).
  - Stores global context: `tags`, `meta`, `input`, `output`.
  - State: `running` -> `success` | `error`.

- **`Step`**: A discrete unit of work within a Run.

  - Hierarchical: Can have a `parentStepId`.
  - Types: e.g., "retrieval", "generation", "filter".
  - Contains `reasoning` (JSON) to explain _why_ a result was produced.

- **`StepCandidate`**: Items processed during a step.

  - Example: In a RAG pipeline, these are the chunks retrieved from a vector DB.
  - Attributes: `score`, `rank`, `payload` (content).

- **`CandidateOutcome`**: The decision made on a candidate.

  - Outcomes: `accepted`, `rejected`, `selected`.
  - Includes `reasonCode` and `reasoningText` (e.g., "Rejected because relevance < 0.7").

- **`StepMetrics`**: Aggregated stats for a step.
  - `rejectionRate`, `candidatesIn`, `acceptedCount`.
  - Useful for identifying stages that are too aggressive or too lenient.

---

## 4. SDK Architecture (Internal)

The SDK is designed to be **unobtrusive**.

```typescript
// Conceptual Flow
const client = new XRayClient({ ... }); // 1. Init Queue
const run = client.startRun(...);       // 2. Gen RunID, Queue 'RunStart'

// 3. User does work
run.step("retrieval", (step) => {
    // 4. Ingest 'Running' state immediately

    step.addCandidates([...]); // 5. Add data to local memory
    step.reject(id, "low_score");

    // 6. On complete:
    //    - Calculate Metrics (client-side)
    //    - Apply Capture Policy (discard excess data)
    //    - Queue 'StepComplete' payload
});
```

### Key Classes

- **`XRayClient`**:

  - Manages the `undici` HTTP connection.
  - Owns the `queue` array.
  - `flush()`: Splices the queue and sends a batch POST request. Handles retries for network glitches (best-effort).

- **`XRayStep`**:
  - Accumulates state (`candidatesIn`, `outcomes`).
  - **`ingestFinal()`**: The critical method that finalizes the step. It computes derived metrics (like rejection rate) and constructs the final JSON payload for the API.

---

## 5. Folder Structure

The repository relies on NPM Workspaces.

### Root

- `package.json`: Orchestrates scripts across workspaces (`dev`, `build`, `test`).
- `.gitignore`, `README.md`, `ARCHITECTURE.md`.

### `packages/api`

The backend service.

- `prisma/schema.prisma`: The Single Source of Truth for the DB schema.
- `src/index.ts`: Entry point, server setup.
- `src/routes.ts`: All HTTP route handlers. Logic is currently centralized here for simplicity.
- `src/validators.ts`: Zod schemas for runtime request validation.
- `src/prisma.ts`: Singleton Prisma client instance.

### `packages/sdk`

The library consumed by users.

- `src/index.ts`: Public API exports (`XRay`, `XRayRun`).
- `src/client.ts`: Internal HTTP transport logic.
- `src/capture.ts`: Logic for `applyCapturePolicy` (sampling algorithms).
- `src/context.ts`: `AsyncLocalStorage` helpers for implicit context propagation.
- `src/types.ts`: Shared TypeScript interfaces.

---

## 6. Implementation Principles & Future Considerations

1.  **Observability-first Database**: The schema is designed to allow SQL queries like "Find all steps where rejection rate > 90%".
2.  **Transactions**: The API handles step ingestion in a `prisma.$transaction`. This ensures that if we write a step, we also write its metrics and candidates atomically.
3.  **Future: Authentication**: Currently, the system assumes a trusted environment. API Key auth exists in the SDK code but needs enforcement on the API side.
4.  **Future: UI**: The next logical component is a React frontend to visualize these traces (Gantt charts, Rejection funnels).
