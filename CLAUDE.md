# Claude Code Guide — clockout

## Diary Workflow

Every change to this project follows a discuss-then-commit loop:

1. **Propose** — suggest the next step with a two-line diary entry (description + command/action, max 80 chars per line). Explain the motivation briefly.
2. **Discuss** — wait for the user to approve, tweak, or reject the step.
3. **Execute** — once approved, apply the change.
4. **Log** — append the two-line entry to `diary.md` (unless the user says "without diary").
5. **Commit** — stage only the relevant files and commit. Always ask the user before committing unless they explicitly said "do it" or "yes" to the full step. Never add `Co-Authored-By` lines to commit messages.

### diary.md format

Entries are numbered. Each step is two lines, indented command in a code span:

```
N. <short description or motivation, max 80 chars>
   `<command or (edit <file>: description), max 80 chars>`
```

Multi-command steps: join with `&&` into a single line. File-edit-only steps: use `(edit <file>: what changed)`.

### Reverting files

Prefer `git restore <file>` over the Edit tool when reverting a tracked file to its last committed state.

## Project Commands

```sh
pnpm install        # install dependencies
pnpm dev            # start dev server
pnpm start          # production server
pnpm test           # run tests (Node built-in runner)
pnpm typecheck      # tsc --noEmit
pnpm check          # Biome lint + format (auto-fix)
```

## Stack

## Layout
