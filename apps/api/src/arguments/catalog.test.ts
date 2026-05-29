import assert from "node:assert/strict";
import test from "node:test";

import { parseLlamaArgumentOptions } from "./catalog.js";

function optionMap(help: string) {
  return new Map(
    parseLlamaArgumentOptions(help).map((option) => [
      option.primaryName,
      option,
    ]),
  );
}

test("parseLlamaArgumentOptions keeps long boolean and numeric options out of list type", () => {
  const options = optionMap(`
----- common params -----
--help, -h                              print usage and exit
-dio,  --direct-io, -ndio, --no-direct-io
                                        use DirectIO if available. (default: disabled)
                                        (env: LLAMA_ARG_DIO)
-ngl,  --gpu-layers, --n-gpu-layers N   max. number of layers to store in VRAM, either an exact number,
                                        'auto', or 'all' (default: auto)
                                        (env: LLAMA_ARG_N_GPU_LAYERS)
`);

  assert.equal(options.get("--help")?.valueType, "flag");
  assert.equal(options.get("--direct-io")?.valueType, "boolean");
  assert.equal(options.get("--gpu-layers")?.valueType, "number");
  assert.equal(options.get("--gpu-layers")?.valueHint, "N");
});

test("parseLlamaArgumentOptions detects comma-separated list options", () => {
  const options = optionMap(`
----- common params -----
-dev,  --device <dev1,dev2,..>          comma-separated list of devices to use for offloading (none = don't
                                        offload)
                                        use --list-devices to see a list of available devices
                                        (env: LLAMA_ARG_DEVICE)
-fitt, --fit-target MiB0,MiB1,MiB2,...
                                        target margin per device for --fit, comma-separated list of values,
                                        single value is broadcast across all devices, default: 1024
                                        (env: LLAMA_ARG_FIT_TARGET)
--rpc SERVERS                           comma separated list of RPC servers (host:port)
                                        (env: LLAMA_ARG_RPC)
--tools TOOL1,TOOL2,...                 experimental: whether to enable built-in tools for AI agents
--lora FNAME                            path to LoRA adapter (use comma-separated values to load multiple
                                        adapters)
--model FNAME                           model path to load
`);

  assert.equal(options.get("--device")?.valueType, "list");
  assert.equal(options.get("--fit-target")?.valueType, "list");
  assert.equal(options.get("--rpc")?.valueType, "list");
  assert.equal(options.get("--tools")?.valueType, "list");
  assert.equal(options.get("--lora")?.valueType, "list");
  assert.equal(options.get("--model")?.valueType, "path");
});
