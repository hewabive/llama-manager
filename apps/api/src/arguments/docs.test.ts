import { strict as assert } from "node:assert";
import test from "node:test";

import { parseArgumentDocFile } from "./docs.js";

test("parseArgumentDocFile reads simple frontmatter and markdown", () => {
  const parsed = parseArgumentDocFile(`---
schema: 1
primaryName: --ctx-size
docStatus: current
aliases:
  - -c
  - --ctx-size
---

# --ctx-size

Long-form engineering docs.
`);

  assert.equal(parsed.frontmatter.schema, 1);
  assert.equal(parsed.frontmatter.primaryName, "--ctx-size");
  assert.equal(parsed.frontmatter.docStatus, "current");
  assert.deepEqual(parsed.frontmatter.aliases, ["-c", "--ctx-size"]);
  assert.match(parsed.markdown, /Long-form engineering docs/);
});
