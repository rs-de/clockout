---
name: verify
description: Build/launch/drive recipe for verifying clockout end-to-end in a real browser.
---

# Verifying clockout

This is a browser app (client-side crypto + IndexedDB, no meaningful
server state yet). Verifying it means driving it in a real browser, not
just `pnpm test:unit`/`pnpm typecheck` — both stayed green through two
crashes that only showed up when the server actually ran.

## Playwright is a permanent devDependency

Per the global `webapp-paradigms` skill's e2e standard: `playwright` and
`@playwright/test` are real, permanent devDependencies here — not a
tool installed and removed per verification pass.

```sh
pnpm test:e2e          # playwright test — runs tests/e2e.spec.ts
pnpm test              # test:unit && test:e2e
```

`playwright.config.ts` auto-starts the app itself (`webServer` block on
`http://localhost:44100`, reusing an already-running `pnpm dev` locally),
so no manual server launch is needed before running these.

**When a feature changes browser-visible behavior, extend
`tests/e2e.spec.ts`** — don't add a new spec file per feature; grow the one
suite.

## Manual one-off driving (exploratory only)

For a quick manual look (not a permanent test), launch the dev server
directly:

```sh
PORT=44177 pnpm dev > /tmp/clockout-dev.log 2>&1 &
sleep 2
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:44177/   # expect 200
tail -f /tmp/clockout-dev.log                                       # watch for crashes
```

`watch: false` is set on the asset server even in dev, so restart the
server after editing any browser-served file (`app/ui/**`, `app/utils/**`,
`app/assets/**`).

Since Playwright is already a project dependency, write a throwaway
`.mjs` driver script directly against `chromium.launch()` (see
`tests/e2e.spec.ts` for the app flow/selectors to reuse) and delete it
when done — no need to install/remove the package anymore.

## Flow to drive

1. Load `/` → setup form (weekly/daily target fields, password + repeat,
   "Save and start tracking" button — English by default; German only
   when the request's `Accept-Language` resolves to `de`).
2. Submit → creates a `TrackingData` doc, saves to IndexedDB, switches to
   the tracking screen (day/week remaining time, Start/Stop toggle).
3. Click Start/Stop → toggles, persists the event, remaining time ticks
   live.
4. Reload → should land straight back on the tracking screen with state
   intact (no password re-entry) — this is the point of the IndexedDB
   local-store layer.
5. To inspect raw persisted state: `page.evaluate` against
   `indexedDB.open("clockout", 1)` → object store `"tracking-data"`, key
   `"current"`.

## Gotchas already hit once — don't reintroduce

- **Asset server `allow` list** (`app/assets.ts`): any directory imported
  by the browser-loaded `clientEntry` (currently `app/ui/**`,
  `app/utils/**`) must be in `allow`, or the dev server throws
  `AssetServerCompilationError: File is not allowed` on every request.
- **No raw `setInterval`/`setTimeout` unguarded in component setup scope.**
  `clientEntry` component setup runs once during SSR too. A bare
  `setInterval(handle.update, ...)` outlives the one-shot SSR render and
  throws `scheduleUpdate not implemented` when it later fires — **and
  crashes the whole Node process**, not just that request. Guard any
  timer with `if (typeof window !== "undefined") { ... }`.
