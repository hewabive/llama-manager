import type { Instance, InstanceHealthSummary } from "@llama-manager/core";
import { Badge, Tooltip } from "@mantine/core";

export function statusColor(status: Instance["status"]) {
  if (status === "running") return "green";
  if (status === "starting" || status === "stopping") return "yellow";
  if (status === "stale") return "orange";
  if (status === "error") return "red";
  return "gray";
}

export function healthStatusColor(status: InstanceHealthSummary["status"]) {
  if (status === "ready") return "green";
  if (status === "starting" || status === "stopping" || status === "loading")
    return "yellow";
  if (status === "degraded" || status === "stale") return "orange";
  if (status === "invalid" || status === "error") return "red";
  return "gray";
}

export function InstanceHealthBadge(props: {
  instance: Instance;
  health: InstanceHealthSummary | undefined;
}) {
  const health = props.health;
  return (
    <Tooltip label={health?.reason ?? "Health summary is loading"} withArrow>
      <Badge
        color={
          health
            ? healthStatusColor(health.status)
            : statusColor(props.instance.status)
        }
        variant="light"
      >
        {health?.status ?? props.instance.status}
      </Badge>
    </Tooltip>
  );
}
