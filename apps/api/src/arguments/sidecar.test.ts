import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { binaryStat } from "./binary-discovery.js";
import { getLlamaArgumentCatalog } from "./catalog.js";
import { parseLlamaArgumentOptions } from "./help-parser.js";
import {
  getCachedArgumentCatalog,
  type CachedArgumentCatalog,
} from "./repository.js";
import {
  argumentCatalogSidecarPath,
  readArgumentCatalogSidecar,
  writeArgumentCatalogSidecar,
} from "./sidecar.js";

function sampleCatalog(binaryPath: string): CachedArgumentCatalog {
  const options = parseLlamaArgumentOptions(`
----- common params -----
--model FNAME                           model path to load
-ngl,  --gpu-layers N                   layers in VRAM
`);
  return {
    binaryPath,
    binarySize: 1234,
    binaryMtimeMs: "100.5",
    binaryModifiedAt: "2026-01-01T00:00:00.000Z",
    helpHash: "deadbeef",
    options,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("argument catalog sidecar round-trips and respects binary stat", () => {
  const dir = mkdtempSync(join(tmpdir(), "llm-args-sidecar-"));
  try {
    const binaryPath = join(dir, "llama-server");
    const catalog = sampleCatalog(binaryPath);
    writeArgumentCatalogSidecar(catalog);

    const stat = {
      binarySize: 1234,
      binaryMtimeMs: "100.5",
      binaryModifiedAt: "2026-01-01T00:00:00.000Z",
    };
    const loaded = readArgumentCatalogSidecar(binaryPath, stat);
    assert.ok(loaded);
    assert.equal(loaded?.helpHash, "deadbeef");
    assert.equal(loaded?.binaryPath, binaryPath);
    assert.deepEqual(
      loaded?.options.map((option) => option.primaryName),
      catalog.options.map((option) => option.primaryName),
    );

    assert.equal(
      readArgumentCatalogSidecar(binaryPath, {
        ...stat,
        binaryMtimeMs: "200.0",
      }),
      null,
    );
    assert.equal(
      readArgumentCatalogSidecar(binaryPath, { ...stat, binarySize: 9999 }),
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("argument catalog sidecar read returns null when absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "llm-args-sidecar-"));
  try {
    assert.equal(
      readArgumentCatalogSidecar(join(dir, "missing"), {
        binarySize: 1,
        binaryMtimeMs: "1",
        binaryModifiedAt: "2026-01-01T00:00:00.000Z",
      }),
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("argument catalog sidecar path is hidden and per-binary", () => {
  assert.equal(
    argumentCatalogSidecarPath("/x/bin/llama-server"),
    "/x/bin/.llama-server.llama-args.json",
  );
});

test("getLlamaArgumentCatalog hydrates the DB from the sidecar without running the binary", () => {
  const dir = mkdtempSync(join(tmpdir(), "llm-args-hydrate-"));
  try {
    const binaryPath = join(dir, "llama-server");
    writeFileSync(binaryPath, "#!/bin/false\n", "utf8");
    const stat = binaryStat(binaryPath);
    writeArgumentCatalogSidecar({
      binaryPath,
      binarySize: stat.binarySize,
      binaryMtimeMs: stat.binaryMtimeMs,
      binaryModifiedAt: stat.binaryModifiedAt,
      helpHash: "abc123",
      options: parseLlamaArgumentOptions(`
----- common params -----
--model FNAME                           model path to load
`),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(getCachedArgumentCatalog(binaryPath), null);

    const catalog = getLlamaArgumentCatalog(binaryPath);
    assert.equal(catalog.cache.hit, true);
    assert.equal(catalog.cache.refreshed, false);
    assert.equal(catalog.source.hash, "abc123");
    assert.ok(
      catalog.options.some((option) => option.primaryName === "--model"),
    );
    assert.ok(getCachedArgumentCatalog(binaryPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
