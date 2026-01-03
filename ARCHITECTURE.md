# XRay System Architecture

## 1. Executive Summary

XRay is an observability platform specifically engineered for pipeline-based systems. It targets complex workflows such as LLM orchestration chains (RAG applications), data transformation pipelines, and multi-step execution jobs.

Unlike traditional Application Performance Monitoring (APM) tools that prioritize system-level metrics like CPU usage, memory consumption, or request throughput, XRay centers on **execution logic observability**. It aims to answer questions regarding the logical flow of data:

- What specific inputs were provided to a processing step?
- Which candidates (e.g., retrieved documents or generated pathways) were evaluated?
- What was the reasoning behind rejecting specific candidates?
- Why was a particular final output selected?

The system is structured as a Monorepo containing two primary packages: a TypeScript SDK (`@xray-sys/sdk`) for client-side instrumentation and a centralized API service (`@xray-sys/api`) for data ingestion and persistent storage.

---

## 2. High-Level System Design

The architecture implements a standard **Producer-Consumer** pattern, decoupled by an HTTP ingestion API.

### System Components

1.  **Client Application (Producer)**

    - Integrates the XRay SDK.
    - Generates traces, steps, and candidate data during execution.
    - Buffers data locally in memory to minimize performance impact.

2.  **API Service (Consumer)**

    - Receives batches of telemetry data via HTTP endpoints.
    - Validates payloads and acts as the write-gateway to the database.
    - Implements idempotency to handle network retries gracefully.

3.  **Database (Storage)**
    - Relational storage (PostgreSQL) optimized for write-heavy workloads.
    - Stores the structural hierarchy of Runs and Steps, alongside JSON-rich payloads for flexible metadata.

---

## 3. Data Model

The data model is designed to capture the complete lifecycle of a "Run" and its constituent "Steps". The relationships form a hierarchical tree structure where a Run contains multiple Steps, and Steps contain granular data points like Candidates and Metrics.


<img width="786" height="601" alt="Screenshot 2026-01-02 at 11 28 59 PM" src="https://github.com/user-attachments/assets/475867c6-f16b-4b16-8ac0-cc6dbf7e0bed" />


### Entity Relationship Diagram

The core entities and their relationships are defined as follows:

- **Run** (1:n) **Step**
- **Step** (1:n) **StepCandidate**
- **Step** (1:n) **CandidateOutcome**
- **Step** (1:1) **StepMetrics**

### Entity Details

#### Run

Represents a single execution of a pipeline.

- `id`: Unique UUID for the run.
- `traceId`: Logical identifier linking the run to a broader system trace (e.g., a request ID).
- `status`: Lifecycle state (running, success, error).
- `pipeline`: Name of the pipeline being executed.
- `tags` / `meta`: Key-value pairs for categorization and arbitrary context.

#### Step

A discrete unit of logic within a Run. Steps can be nested, allowing for complex tree-like execution traces.

- `id`: Unique UUID for the step.
- `runId`: Foreign key to the parent Run.
- `parentStepId`: Optional pointer to a parent step for recursive structures.
- `type`: Classification of the step (e.g., "retrieval", "generation", "filter").
- `input` / `output`: The actual data flowing into and out of the step.
- `reasoning`: A JSON object capturing the "thinking" process or logic used during the step.

#### StepCandidate

Items processed or evaluated during a step. In a RAG context, these would be the chunks retrieved from a vector database.

- `candidateId`: Identifier for the item.
- `candidateType`: Classification of the item (e.g., "document", "chunk").
- `rank`: The ordinal position of the candidate (common in ranked retrieval lists).
- `score`: Usefulness score (e.g., vector similarity and confidence score).
- `payload`: The actual content of the candidate.

#### CandidateOutcome

The decision made regarding a specific candidate.

- `outcome`: The final status (accepted, rejected, selected).
- `reasonCode`: A low-cardinality string code for the decision (e.g., "TOO_SHORT", "LOW_SIMILARITY").
- `reasoningText`: Human-readable explanation for the decision.

#### StepMetrics

Aggregated statistics for a step, computed client-side before ingestion.

- `candidatesIn`: Total number of candidates observed.
- `candidatesCaptured`: Number of candidates actually sent to the backend (affected by capture policies).
- `rejectionRate`: The ratio of rejected candidates to total candidates.
- `acceptedCount`, `rejectedCount`, `selectedCount`: Raw counters.

---

## 4. Capture Policies

To prevent "observability storage explosion," the XRay SDK implements intelligent client-side data reduction known as **Capture Policies**. In high-throughput systems (like search or RAG), a single step might evaluate thousands of candidates. Storing the full payload for every candidate is often unnecessary and cost-prohibitive.

The capture policy is applied at the end of a step, just before the final payload is constructed. It determines which candidates strictly remain in the telemetry and which are discarded.

### Policy Modes

1.  **THRESHOLD** (Default)

    - Acts as an adaptive mode.
    - If the number of candidates is below a defined threshold (default 200), it behaves like `FULL` (keeps everything).
    - If the number exceeds the threshold, it switches to `TOP_K` to preserve only the most relevant items.

2.  **TOP_K**

    - Preserves only the top `k` candidates associated with the lowest rank values (i.e., Rank 1 is better than Rank 10).
    - Useful for retrieval tasks where only the top results matter for debugging.

3.  **SAMPLE**

    - Performs random reservoir sampling to keep a fixed number of `sampleN` items.
    - Useful for high-volume data streams where statistical representation is sufficient.

4.  **FULL**

    - Keeps every single candidate and outcome.
    - Use with caution in production environments.

5.  **SUMMARY_ONLY**
    - Discards all candidate payloads and outcome details.
    - Only sends the `StepMetrics` (counts and rates) and the `rejectionHistogram`.

### Histogram Preservation

Crucially, even when candidates are discarded by a policy, the **rejection histogram** is computed over the _entire_ dataset. This means you can still see that 500 items were rejected due to "LOW_SCORE", even if you only stored the payload for the top 5 items. This decouples metric accuracy from storage costs.

---

## 5. Detailed Implementation Design

### SDK Architecture (`@xray-sys/sdk`)

The SDK is designed to be non-blocking and fault-tolerant.

**1. Asynchronous Queuing**

- When a user interacts with the SDK (e.g., `step.end()`), the data is not sent immediately.
- Instead, the payload is pushed to an in-memory queue within the `XRayClient`.
- A background flush mechanism (or explicit `flush()` call) processes this queue, batching multiple events into a single HTTP request to reduce network overhead.

**2. Client-Side Computation**

- To reduce load on the API and database, metrics are computed on the client.
- The `XRayStep.ingestFinal()` method calculates `rejectionRate`, builds the histograms, and filters arrays based on the active Capture Policy. The backend simply stores the pre-computed results.

**3. Implicit Context Propagation**

- The SDK utilizes Node.js `AsyncLocalStorage` to manage `runId` and `traceId` context.
- This allows deep functions to access the current tracing context without requiring argument drilling through the entire call stack.

### API Architecture (`@xray-sys/api`)

The API serves as the ingestion gateway and is built with Node.js, Express, and Prisma.

**1. Idempotency and Upserts**

- Network unreliability requires the system to handle duplicate data gracefully.
- The SDK may retry sending a "Step Complete" event if the first attempt times out.
- The API uses Prisma `upsert` operations. If a step with the given ID already exists, it updates the record; otherwise, it creates a new one. This ensures eventual consistency without duplicate rows.

**2. Atomic Transactions**

- Writing a finished step is a complex operation involving multiple tables (`Step`, `StepMetrics`, `StepCandidate`, `CandidateOutcome`).
- These writes are wrapped in a `prisma.$transaction`. This ensures ACID compliance: either the entire step data is written successfully, or none of it is, preventing partial states where metrics exist without their corresponding candidates.

**3. Zod Usage**

- All incoming requests are validated against strict Zod schemas sharing definitions with the SDK types. This contract ensures that invalid data is rejected at the edge before it can pollute the database.
