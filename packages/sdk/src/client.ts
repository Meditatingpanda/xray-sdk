import { request } from "undici";
import { XRayConfig } from "./types";

type QueuedEvent = { path: string; body: any };

export class XRayClient {
    private cfg: Required<XRayConfig>;
    private q: QueuedEvent[] = [];
    private timer?: NodeJS.Timeout;

    constructor(cfg: XRayConfig) {
        this.cfg = {
            endpoint: cfg.endpoint.replace(/\/$/, ""),
            apiKey: cfg.apiKey,
            timeoutMs: cfg.timeoutMs ?? 1500,
            flushIntervalMs: cfg.flushIntervalMs ?? 500,
            maxQueue: cfg.maxQueue ?? 2000,
            onError: cfg.onError ?? (() => { })
        };
        this.timer = setInterval(() => this.flush().catch(this.cfg.onError), this.cfg.flushIntervalMs);
        this.timer.unref?.();
    }

    enqueue(path: string, body: any) {
        this.q.push({ path, body });
        if (this.q.length > this.cfg.maxQueue) this.q.splice(0, this.q.length - this.cfg.maxQueue);
    }

    async flush() {
        if (!this.q.length) return;
        const batch = this.q.splice(0, Math.min(this.q.length, 50));

        for (const ev of batch) {
            try {
                await request(`${this.cfg.endpoint}${ev.path}`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(this.cfg.apiKey ? { "x-api-key": this.cfg.apiKey } : {})
                    },
                    body: JSON.stringify(ev.body),
                    headersTimeout: this.cfg.timeoutMs,
                    bodyTimeout: this.cfg.timeoutMs
                });
            } catch (e) {
                // Put back (best-effort) and bail; keep pipeline unaffected
                this.q.unshift(ev);
                throw e;
            }
        }
    }

    shutdown() {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
