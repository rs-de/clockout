---
name: conventional-commits
description: Commit message format (Conventional Commits) for clockout — types, scopes, body/footer style. Use whenever writing a `git commit -m` message in this repo.
---

# Conventional Commits for clockout

Every commit subject follows `type(optional-scope): description`. The
whole history (rewritten 2026-07-25, see `pre-conventional-commits-rewrite`
backup branch) conforms to this — match its style, don't invent a new one.

## Types actually used in this repo

- `feat` — new user-visible capability or behavior
- `fix` — bug fix
- `refactor` — internal restructuring, no behavior change
- `style` — visual/CSS-only change, no logic change
- `chore` — tooling, deps, config, build pipeline, assets (favicon, etc.)
- `docs` — docs/skill/paradigm files only
- `test` — test-only additions/changes
- `revert` — undoes a prior commit; subject names what's being reverted

Scope is optional and rare here — only reach for it when a type applies to
one clearly-named subsystem repeatedly, e.g. `chore(i18n):`,
`refactor(i18n):`. Don't invent scopes for one-off commits.

## Subject line

- Lowercase after the `type:` — `fix: dev server never picked up file
  edits`, not `Fix: ...`.
- Imperative/description mood (`add`, `drop`, `hide`), not past tense.
- No trailing period.
- Can run long and descriptive — this repo favors informative subjects
  over strict 50-char limits (e.g. `fix: source-map 503 — returning a
  body-consumed Response crashes the server`). An em dash (`—`) is the
  house style for joining a headline to its detail within one subject,
  in place of a second colon.
- A commit that bundles a few related edits can list them
  semicolon-separated in one subject (`fix: safari fieldset focus shift,
  headline casing, add loading spinner`) rather than fabricating multiple
  commits after the fact.

## Body — this is where clockout commits earn their keep

Almost every non-trivial commit here has a body explaining *why*, often
with the root cause of a bug, what was verified, and what was deliberately
left alone. Keep doing this — it's the most valuable part of the history,
not an afterthought. Bullet points (`- `) are used freely for multi-part
commits. No fixed template; write what a future reader would need to not
re-debug the same thing.

## Breaking changes / revert

- Not used yet in this repo (no `!` or `BREAKING CHANGE:` footer so far) —
  add one only if a change genuinely breaks something for another
  consumer of this code, which doesn't really apply to a single-app repo.
- `revert:` commits name what's being undone in the subject and explain
  why in the body (see `revert: source-maps-off — it broke
  @remix-run/ui's own prebuilt map passthrough`), rather than leaving
  git's raw auto-generated `Revert "..."` text as the whole message.

## Never add `Co-Authored-By` lines

Per `CLAUDE.md`'s diary workflow — this applies to every commit
regardless of type.
