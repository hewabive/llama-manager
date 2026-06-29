import type { ApiProxyCachedResponsePayload } from "./pipeline.js";

type InFlightEntry = {
  promise: Promise<ApiProxyCachedResponsePayload | null>;
  resolve: (value: ApiProxyCachedResponsePayload | null) => void;
};

const inFlight = new Map<string, InFlightEntry>();

const coalesceTimeoutMs = 120_000;

export function registerApiProxyInFlight(key: string): void {
  if (inFlight.has(key)) {
    return;
  }
  let resolve!: (value: ApiProxyCachedResponsePayload | null) => void;
  const promise = new Promise<ApiProxyCachedResponsePayload | null>((r) => {
    resolve = r;
  });
  inFlight.set(key, { promise, resolve });
}

export function settleApiProxyInFlight(
  key: string,
  value: ApiProxyCachedResponsePayload | null,
): void {
  const entry = inFlight.get(key);
  if (!entry) {
    return;
  }
  inFlight.delete(key);
  entry.resolve(value);
}

export function findApiProxyInFlight(
  key: string,
): Promise<ApiProxyCachedResponsePayload | null> | null {
  const entry = inFlight.get(key);
  if (!entry) {
    return null;
  }
  return Promise.race([
    entry.promise,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => {
        settleApiProxyInFlight(key, null);
        resolve(null);
      }, coalesceTimeoutMs);
      timer.unref?.();
    }),
  ]);
}

export function clearApiProxyInFlight(): void {
  for (const key of [...inFlight.keys()]) {
    settleApiProxyInFlight(key, null);
  }
}
