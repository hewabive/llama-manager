# Argument Help Workflow

Engineering help for `llama-server` arguments lives in
`content/llama-args/llama-server/*.md`.

## Source Of Truth

The synchronization source is the generated help block in the configured
`llama.cpp` checkout:

```text
tools/server/README.md
<!-- HELP_START --> ... <!-- HELP_END -->
```

llama-manager stores a reviewed snapshot of that block in:

```text
content/llama-args/source/server-help.generated.md
content/llama-args/source/help-source.json
```

The stored hash is the only automatic stale signal. Individual Markdown files do
not carry review statuses or per-file reviewed hashes.

## User Signal

The `Arguments` page compares the stored snapshot hash with the current generated
help block from the configured source repo.

- Hash matches: no action.
- Hash differs: show one global warning that the argument reference may not
  match the current llama.cpp source.
- Missing source/snapshot: show a source-sync error.

The app does not mark individual argument docs as needing review when llama.cpp
gets a new commit.

## Agent Workflow

Use the repo-local Codex skill:

```text
.codex/skills/llama-arg-help-sync/SKILL.md
```

Useful commands:

```bash
pnpm --filter @llama-manager/api args:docs:source-sync
pnpm --filter @llama-manager/api args:docs:source-sync -- --diff
pnpm --filter @llama-manager/api args:docs:source-sync -- --write
pnpm --filter @llama-manager/api args:docs:quality
```

The agent reviews the generated help diff, edits only affected Engineering help
files, deletes docs for removed arguments after checking they were not renamed,
then writes the new snapshot/hash with `--write`.

## Hygiene Rules

- Do not commit generated work-order text.
- Useful permanent changes belong in argument Markdown files, the source
  snapshot, or app code.
- If scratch notes are unavoidable, put them under
  `runtime/tmp/argument-help/`, start the file with
  `TEMPORARY - remove after task`, and delete it before final verification.
- Do not mass-edit all argument docs just because the llama.cpp commit changed.

## Completion Criteria

- The generated help diff has been reviewed.
- Affected docs are updated.
- Docs for removed arguments are deleted, not kept with a legacy status.
- `args:docs:source-sync` reports `"inSync": true`.
- `args:docs:quality` passes.
