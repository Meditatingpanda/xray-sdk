# Xray Sys

Hey! Welcome to the `xray-sys` repository. This is a lightweight observability system designed to track, monitor, and analyze execution pipelines (think LLM chains, data workflows, or complex job sequences).

The goal here is simple: provide a way to trace exactly what happens inside your runs—step by step—capturing inputs, outputs, errors, and even the reasoning behind decisions.

## 🏗 System Architecture

This is a monorepo setup containing the core pieces of the system:

- **`packages/api`**: The backend service built with Express and PostgreSQL. It handles data ingestion and exposes the API for creating/updating runs and steps. It uses Prisma for ORM.
- **`packages/sdk`**: A TypeScript SDK for instrumenting your applications. You drop this into your code to start recording runs automatically.
- **`packages/examples`**: (Work in progress) Practical examples of how to integrate the SDK.

### How it works

1.  **Instrumentation**: You wrap your code blocks using the SDK.
2.  **Ingestion**: The SDK sends telemetry data (runs, steps, candidates) to the API.
3.  **Storage**: The API persists structured traces into PostgreSQL, capturing hierarchy (`Run` -> `Step` -> `Child Step`) and detailed metrics.
4.  **Analysis**: (Future) You query the data to understand failure rates, latency bottlenecks, or audit decision paths.

## 🚀 Setup Instructions

Prerequisites:

- Node.js (v18+ recommended)
- PostgreSQL running locally or accessible via URL.

### 1. Installation

Clone the repo and install dependencies from the root:

```bash
npm install
```

### 2. Database Setup

You need a Postgres database. Create a `.env` file in `packages/api/` with your database URL (or update the existing one):

```env
DATABASE_URL="postgresql://user:password@localhost:5432/xray_db"
```

Then run the migrations to create the schema:

```bash
cd packages/api
npm run prisma:migrate
```

### 3. Running the API

To start the backend in development mode:

```bash
# From packages/api
npm run dev
```

The server usually starts on port `3000` (or whatever is defined in your environment).

### 4. Building the SDK

If you are making changes to the SDK:

```bash
cd packages/sdk
npm run build
```

## 🛠 Usage (Quick Start)

_Check the `packages/examples` folder for full code snippets._

Roughly, instrumenting a function looks like this:

```typescript
import { XrayClient } from "@xray-sys/sdk";

const client = new XrayClient({ baseUrl: "http://localhost:3000" });

async function main() {
  const run = await client.startRun({ pipeline: "data-processing-v1" });

  try {
    // Record a step
    await run.step("fetch-data", async (step) => {
      // do your work...
      step.complete({ output: { items: 5 } });
    });

    await run.complete({ status: "success" });
  } catch (err) {
    await run.fail(err);
  }
}
```

## ⚠️ Known Limitations & Future Work

Just so you know what you're getting into, here is the current status:

- **No UI**: Currently, this is a headless system. You have to query the database directly or use Prisma Studio (`npm run prisma:studio` in `packages/api`) to view the data. A dashboard is the next big milestone.
- **Auth**: The API is currently open (no authentication middleware). Don't expose this to the public internet without adding an auth layer.
- **SDK Features**: The SDK does basic tracing. Advanced features like automatic error capturing for specialized libraries aren't there yet.
- **Validation**: Input validation is minimal beyond what Zod enforces at the API level.

## Contributing

Feel free to dive in! If you modify the DB schema, remember to run `prisma generate` and `prisma migrate`.

Happy coding! 🚀
