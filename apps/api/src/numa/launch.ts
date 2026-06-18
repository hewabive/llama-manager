import type { Instance } from "@llama-manager/core";

import { detectNumaBind } from "./capability.js";
import { applyNumaPin, buildPinnedShimArgs } from "./cgroup.js";
import { readNumaTopology } from "./topology.js";

export type NumaLaunch = {
  binary: string;
  args: string[];
  cgroupDir: string | null;
};

function plain(binary: string, args: string[]): NumaLaunch {
  return { binary, args, cgroupDir: null };
}

export function resolveNumaLaunch(
  instance: Instance,
  binary: string,
  cliArgs: string[],
): NumaLaunch {
  const numa = instance.numa;
  if (!numa) {
    return plain(binary, cliArgs);
  }

  if (numa.mode === "bind") {
    if (!detectNumaBind()) {
      return plain(binary, cliArgs);
    }
    const node = readNumaTopology().find((entry) => entry.id === numa.node);
    if (!node) {
      throw new Error(`NUMA node ${numa.node} is not present on this host`);
    }
    const cgroupDir = applyNumaPin(instance.name, node);
    return {
      binary: "sh",
      args: buildPinnedShimArgs(`${cgroupDir}/cgroup.procs`, binary, cliArgs),
      cgroupDir,
    };
  }

  return plain(binary, cliArgs);
}
