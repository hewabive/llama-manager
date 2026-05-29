# Argument Help Workflow

Engineering help for `llama-server` arguments lives in
`content/llama-args/llama-server/*.md`.

## Source Of Truth

- The canonical `llama.cpp` checkout is stored in `llama_source_settings`.
- `reviewedLlamaCppCommit` in each Markdown file records the source commit that
  was reviewed.
- `reviewedHelpHash` remains a fallback diagnostic for the selected binary
  `llama-server --help` output.

## Work Orders

Work orders are generated on demand and are not project artifacts.

- UI: `Args` -> `Source sync` -> `Work order`.
- API: `GET /api/llama-args/docs-work-order`.
- CLI: `pnpm --filter @llama-manager/api args:docs:work-order -- --limit 10`.

The generator writes nothing to disk. It returns Markdown in the API response or
prints it to stdout in the CLI.

## Hygiene Rules

- Do not commit generated work-order text.
- Useful permanent changes belong in the argument Markdown files or app code.
- If scratch notes are unavoidable, put them under
  `runtime/tmp/argument-help/`, start the file with
  `TEMPORARY - remove after task`, and delete it before final verification.
- After editing docs, run
  `pnpm --filter @llama-manager/api args:docs:quality -- --changed`.

## Completion Criteria

For each reviewed argument:

- verify behavior against the canonical `llama.cpp` source checkout;
- update practical Russian engineering help;
- remove stale generated boilerplate;
- set `docStatus: current` only after review;
- set `reviewedLlamaCppCommit` to the current source commit.
