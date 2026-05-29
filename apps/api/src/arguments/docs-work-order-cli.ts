import {
  LlamaArgumentDocsWorkOrderRequestSchema,
  type LlamaArgumentDocStatus,
} from "@llama-manager/core";

import { migrate } from "../db/index.js";
import { getLlamaArgumentDocsWorkOrder } from "./docs-work-order.js";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function statusesFromArg(value: string | undefined) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) as LlamaArgumentDocStatus[] | undefined;
}

migrate();

const parsed = LlamaArgumentDocsWorkOrderRequestSchema.safeParse({
  binaryPath: argValue("--binary"),
  limit: argValue("--limit"),
  statuses: statusesFromArg(argValue("--status")),
  primaryName: argValue("--arg"),
});

if (!parsed.success) {
  console.error(JSON.stringify(parsed.error.flatten(), null, 2));
  process.exitCode = 1;
} else {
  const workOrder = getLlamaArgumentDocsWorkOrder(parsed.data);
  console.log(
    hasFlag("--json") ? JSON.stringify(workOrder, null, 2) : workOrder.markdown,
  );
}
