import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

function executableName(name: string) {
  if (process.platform === "win32" && !/\.(?:bat|cmd|exe)$/i.test(name)) {
    return `${name}.exe`;
  }
  return name;
}

function findExecutableInPath(name: string, pathValue: string | undefined) {
  if (!pathValue) {
    return null;
  }

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = resolve(directory, executableName(name));
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveExecutable(value: string, env: NodeJS.ProcessEnv) {
  if (isAbsolute(value)) {
    return existsSync(value) ? value : null;
  }
  if (value.includes("/") || value.includes("\\")) {
    const candidate = resolve(value);
    return existsSync(candidate) ? candidate : null;
  }
  return findExecutableInPath(value, env.PATH);
}

function envPath(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function findNvcc(env: NodeJS.ProcessEnv) {
  const explicit = envPath(env, "CUDACXX");
  if (explicit) {
    return resolveExecutable(explicit, env) ?? explicit;
  }

  const fromPath = findExecutableInPath("nvcc", env.PATH);
  if (fromPath) {
    return fromPath;
  }

  const cudaRoots = [
    envPath(env, "CUDA_HOME"),
    envPath(env, "CUDA_PATH"),
    "/usr/local/cuda",
    "/opt/cuda",
  ].filter((item): item is string => Boolean(item));

  for (const root of cudaRoots) {
    const candidate = join(root, "bin", executableName("nvcc"));
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isCudaToolkitAvailable() {
  return findNvcc(process.env) !== null;
}
