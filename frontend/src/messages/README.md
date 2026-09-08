Message structure guidelines

- Do not duplicate top-level namespaces (e.g., `canvas`, `sidebar`, `common`).
- Always extend the existing namespace (search for the last occurrence in the file).
- For `canvas`, all menu, editor, link, selection keys are consolidated under a single block.
- Run `npm run i18n:check` to detect duplicate top-level namespaces and public copy corruption before committing.

