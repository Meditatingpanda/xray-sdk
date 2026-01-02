import { AsyncLocalStorage } from "node:async_hooks";

export type XRayContext = {
    runId: string;
    traceId: string;
};

export const als = new AsyncLocalStorage<XRayContext>();

export function getCtx(): XRayContext | undefined {
    return als.getStore();
}
