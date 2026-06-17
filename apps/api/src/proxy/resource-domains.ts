import type {
  ApiProxySchedulerPoolInput,
  InstanceMemoryDraw,
  MemoryPool,
} from "@llama-manager/core";

export function computeDomains(
  draws: InstanceMemoryDraw[],
  pools: Pick<MemoryPool, "id">[],
): string[] {
  const poolIds = new Set(pools.map((pool) => pool.id));
  const domains = new Set<string>();
  for (const draw of draws) {
    if (poolIds.has(draw.poolId)) {
      domains.add(draw.poolId);
    }
  }
  return [...domains].sort();
}

export function requestComputeDomains(
  draws: InstanceMemoryDraw[],
  pools: Pick<ApiProxySchedulerPoolInput, "poolId">[],
): string[] {
  return computeDomains(
    draws,
    pools.map((pool) => ({ id: pool.poolId })),
  );
}

export function requestNeedsComputeLease(
  draws: InstanceMemoryDraw[],
  pools: Pick<ApiProxySchedulerPoolInput, "poolId">[],
): boolean {
  return requestComputeDomains(draws, pools).length > 0;
}
