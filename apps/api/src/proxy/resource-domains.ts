import type { InstanceMemoryDraw, MemoryPool } from "@llama-manager/core";

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
