import {
  LlamaArgumentDocsSyncReportSchema,
  type LlamaArgumentDocsSyncReport,
} from "@llama-manager/core";

import { getLlamaSourceStatus } from "../llama/source-repository.js";
import { argumentDocsDirectory } from "./docs.js";
import { getLlamaArgumentHelpSourceSync } from "./docs-source.js";

function nowIso() {
  return new Date().toISOString();
}

export function getLlamaArgumentDocsSyncReport(): LlamaArgumentDocsSyncReport {
  const checkedAt = nowIso();
  const source = getLlamaSourceStatus();
  const helpSource = getLlamaArgumentHelpSourceSync();

  return LlamaArgumentDocsSyncReportSchema.parse({
    checkedAt,
    source,
    helpSource,
    docsDirectory: argumentDocsDirectory,
  });
}
