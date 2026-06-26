import type { Instance, MemoryPool } from "@llama-manager/core";
import { Badge, Group, Stack, Tooltip } from "@mantine/core";

import { hasConfiguredArg, launchModeFromArgs } from "./instance-form-helpers";

type RoleBadge = { label: string; color: string; tooltip: string };

function instanceRole(instance: Instance): RoleBadge {
  if (instance.kind === "rpc-worker") {
    return {
      label: "rpc-worker",
      color: "indigo",
      tooltip: "RPC backend worker",
    };
  }
  const mode = launchModeFromArgs(instance.args);
  if (mode === "router") {
    return {
      label: "router",
      color: "teal",
      tooltip: "Preset router (--models-preset)",
    };
  }
  if (mode === "remote") {
    if (hasConfiguredArg(instance.args, "--hf-repo")) {
      return {
        label: "HF",
        color: "grape",
        tooltip: "Remote HuggingFace model (--hf-repo)",
      };
    }
    return {
      label: "URL",
      color: "grape",
      tooltip: "Remote model URL (--model-url)",
    };
  }
  return {
    label: "single",
    color: "blue",
    tooltip: "Single local model (--model)",
  };
}

type Chip = { key: string; label: string; tooltip: string };

const NGL_KEYS = ["--n-gpu-layers", "-ngl", "--gpu-layers"];

function deviceTokens(value: Instance["args"][string] | undefined): string[] {
  const raw = Array.isArray(value)
    ? value.join(",")
    : value === undefined || value === null
      ? ""
      : String(value);
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function computeChips(
  instance: Instance,
  poolsById: Map<string, MemoryPool>,
): Chip[] {
  const gpuDraws = instance.memory.filter(
    (draw) => poolsById.get(draw.poolId)?.kind === "gpu",
  );
  if (gpuDraws.length > 0) {
    return gpuDraws.map((draw) => ({
      key: `gpu:${draw.poolId}`,
      label: draw.poolId,
      tooltip: poolsById.get(draw.poolId)?.name ?? draw.poolId,
    }));
  }
  const devices = deviceTokens(instance.args["--device"]);
  if (devices.length > 0) {
    return devices.map((device) => ({
      key: `device:${device}`,
      label: device,
      tooltip: `--device ${device}`,
    }));
  }
  const nglValue = NGL_KEYS.map((key) => instance.args[key]).find(
    (value) => value !== undefined,
  );
  const ngl = nglValue === undefined ? 0 : Number(nglValue);
  if (Number.isFinite(ngl) && ngl > 0) {
    return [{ key: "gpu", label: "GPU", tooltip: "GPU offload (-ngl)" }];
  }
  return [{ key: "cpu", label: "CPU", tooltip: "No GPU offload declared" }];
}

function numaChip(instance: Instance): Chip | null {
  const numa = instance.numa;
  if (!numa) {
    return null;
  }
  if (numa.mode === "bind") {
    return {
      key: "numa",
      label: `numa bind ${numa.node}`,
      tooltip: `NUMA: CPUs and memory bound to node ${numa.node}`,
    };
  }
  const nodes = numa.nodes.length > 0 ? numa.nodes.join("/") : "all";
  return {
    key: "numa",
    label: `numa il ${nodes}`,
    tooltip: `NUMA: memory interleaved across ${
      nodes === "all" ? "all nodes" : `nodes ${nodes}`
    }`,
  };
}

function envChip(instance: Instance): Chip | null {
  const keys = Object.keys(instance.env);
  if (keys.length === 0) {
    return null;
  }
  return {
    key: "env",
    label: `env ×${keys.length}`,
    tooltip: keys.join(", "),
  };
}

export function InstanceTypeCell(props: {
  instance: Instance;
  poolsById: Map<string, MemoryPool>;
}) {
  const role = instanceRole(props.instance);
  const chips = [
    ...computeChips(props.instance, props.poolsById),
    numaChip(props.instance),
    envChip(props.instance),
  ].filter((chip): chip is Chip => chip !== null);

  return (
    <Stack className="instance-type-cell" gap={4} align="flex-start">
      <Tooltip label={role.tooltip} withArrow>
        <Badge color={role.color} variant="light" tt="none">
          {role.label}
        </Badge>
      </Tooltip>
      <Group className="instance-type-chips" gap={4}>
        {chips.map((chip) => (
          <Tooltip key={chip.key} label={chip.tooltip} withArrow>
            <Badge variant="default" size="xs" tt="none">
              {chip.label}
            </Badge>
          </Tooltip>
        ))}
      </Group>
    </Stack>
  );
}
