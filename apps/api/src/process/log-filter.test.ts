import { strict as assert } from "node:assert";
import test from "node:test";

import {
  filterManagedLlamaLogChunk,
  isRoutineManagerProbeRequestLogLine,
} from "./log-filter.js";

const localAddresses = new Set(["127.0.0.1", "82.38.68.56"]);

test("detects routine local llama-manager probe request log lines", () => {
  assert.equal(
    isRoutineManagerProbeRequestLogLine(
      "srv  log_server_r: done request: GET /slots 82.38.68.56 200",
      localAddresses,
    ),
    true,
  );
  assert.equal(
    isRoutineManagerProbeRequestLogLine(
      "srv  log_server_r: done request: GET /api-prefix/v1/models 127.0.0.1 200",
      localAddresses,
    ),
    true,
  );
});

test("keeps non-local and non-routine request log lines", () => {
  assert.equal(
    isRoutineManagerProbeRequestLogLine(
      "srv  log_server_r: done request: GET /slots 203.0.113.10 200",
      localAddresses,
    ),
    false,
  );
  assert.equal(
    isRoutineManagerProbeRequestLogLine(
      "srv  log_server_r: done request: POST /v1/chat/completions 127.0.0.1 200",
      localAddresses,
    ),
    false,
  );
  assert.equal(
    isRoutineManagerProbeRequestLogLine(
      "srv  log_server_r: done request: GET /props 127.0.0.1 500",
      localAddresses,
    ),
    false,
  );
});

test("filters only complete routine request lines from chunks", () => {
  const chunk = [
    "main: loading model",
    "srv  log_server_r: done request: GET /health 127.0.0.1 503",
    "srv  log_server_r: done request: POST /v1/chat/completions 127.0.0.1 200",
    "load_tensors: loading model tensors",
  ].join("\n");

  assert.equal(
    filterManagedLlamaLogChunk(`${chunk}\n`, localAddresses),
    [
      "main: loading model",
      "srv  log_server_r: done request: POST /v1/chat/completions 127.0.0.1 200",
      "load_tensors: loading model tensors",
      "",
    ].join("\n"),
  );
});

test("does not drop partial request lines without a newline", () => {
  const chunk = "srv  log_server_r: done request: GET /slots 127.0.0.1 200";

  assert.equal(filterManagedLlamaLogChunk(chunk, localAddresses), chunk);
});
