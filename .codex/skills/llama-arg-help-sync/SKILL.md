---
name: llama-arg-help-sync
description: Use when llama-manager reports that the stored llama-server generated help snapshot differs from the configured llama.cpp tools/server/README.md help block, and Engineering help in content/llama-args/llama-server needs to be refreshed.
metadata:
  short-description: Sync llama-server argument Engineering help
---

# llama-server Argument Help Sync

Use this skill only for synchronizing `llama-server` argument documentation after
the generated help block in `llama.cpp/tools/server/README.md` changes.

## Workflow

1. Check the generated help diff:

```bash
pnpm --filter @llama-manager/api args:docs:source-sync -- --diff
```

2. Identify only the affected arguments from added, removed, or changed table
   rows. Do not review every argument just because the llama.cpp commit changed.

3. For each affected argument, edit the matching file in
   `content/llama-args/llama-server/*.md`.

4. If an argument is new, create a focused Russian Engineering help file using
   nearby argument docs as style references. Include practical behavior, safe
   defaults, interactions, diagnostics, and relevant source/issue links when useful.

5. If an argument disappeared, mark the matching doc `docStatus: orphaned` only
   after confirming it is not just renamed or moved.

6. After the docs match the new generated help, update the stored snapshot and
   hash:

```bash
pnpm --filter @llama-manager/api args:docs:source-sync -- --write
```

7. Validate:

```bash
pnpm --filter @llama-manager/api args:docs:quality
pnpm --filter @llama-manager/api args:docs:source-sync
```

The final source-sync report should show `"inSync": true`.

## Rules

- Keep the user-facing app logic out of this task unless the generated help
  format itself changed and the extractor must be adjusted.
- Do not save work-order text in the repository.
- If scratch notes are unavoidable, put them under
  `runtime/tmp/argument-help/`, start with `TEMPORARY - remove after task`, and
  delete them before finishing.
- Do not mass-edit `reviewedLlamaCppCommit` or `reviewedHelpHash` in every doc.
  The source snapshot hash is the synchronization signal.
- Prefer `rg` and targeted source inspection in the configured llama.cpp repo.
