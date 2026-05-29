import { strict as assert } from "node:assert";
import test from "node:test";

import { parseArgumentDocFile } from "./docs.js";
import { extractGeneratedHelpBlock } from "./docs-source.js";

test("parseArgumentDocFile reads simple frontmatter and markdown", () => {
  const parsed = parseArgumentDocFile(`---
schema: 1
primaryName: --ctx-size
aliases:
  - -c
  - --ctx-size
---

# --ctx-size

Long-form engineering docs.
`);

  assert.equal(parsed.frontmatter.schema, 1);
  assert.equal(parsed.frontmatter.primaryName, "--ctx-size");
  assert.deepEqual(parsed.frontmatter.aliases, ["-c", "--ctx-size"]);
  assert.match(parsed.markdown, /Long-form engineering docs/);
});

test("extractGeneratedHelpBlock reads the generated README section", () => {
  const block = extractGeneratedHelpBlock(`# Server

before

<!-- HELP_START -->

| Argument | Explanation |
| -------- | ----------- |
| \`--port N\` | port |

<!-- HELP_END -->

after
`);

  assert.match(block, /^<!-- HELP_START -->/);
  assert.match(block, /`--port N`/);
  assert.match(block, /<!-- HELP_END -->\n$/);
  assert.doesNotMatch(block, /before|after/);
});
