import type {
  ApiProxySchedulerPoolInput,
  InstanceMemoryDraw,
  MemoryPool,
} from "@llama-manager/core";

export function gpuComputeDomains(
  draws: InstanceMemoryDraw[],
  pools: Pick<MemoryPool, "id" | "kind">[],
): string[] {
  const gpuPoolIds = new Set(
    pools.filter((pool) => pool.kind === "gpu").map((pool) => pool.id),
  );
  const domains = new Set<string>();
  for (const draw of draws) {
    if (gpuPoolIds.has(draw.poolId)) {
      domains.add(draw.poolId);
    }
  }
  return [...domains].sort();
}

export function requestComputeDomains(
  draws: InstanceMemoryDraw[],
  pools: Pick<ApiProxySchedulerPoolInput, "poolId" | "kind">[],
): string[] {
  return gpuComputeDomains(
    draws,
    pools.map((pool) => ({ id: pool.poolId, kind: pool.kind })),
  );
}

export function requestNeedsComputeLease(
  draws: InstanceMemoryDraw[],
  pools: Pick<ApiProxySchedulerPoolInput, "poolId" | "kind">[],
): boolean {
  return requestComputeDomains(draws, pools).length > 0;
}
