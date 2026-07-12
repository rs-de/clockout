---
name: verify
description: Build/launch/drive recipe for verifying clockout end-to-end in a real browser.
---

# Verifying clockout

This is a browser app (client-side crypto + IndexedDB, no meaningful
server state yet). Verifying it means driving it in a real browser, not
just `pnpm test`/`pnpm typecheck` — both stayed green through two crashes
that only showed up when the server actually ran.

## Launch

```sh
PORT=44177 pnpm dev > /tmp/clockout-dev.log 2>&1 &
sleep 2
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:44177/   # expect 200
tail -f /tmp/clockout-dev.log                                       # watch for crashes
```

`watch: false` is set on the asset server even in dev, so restart the
server after editing any browser-served file (`app/ui/**`, `app/utils/**`,
`app/assets/**`).

## Drive it

No Playwright installed in the project (adding it is a real dependency
decision — ask first, like fake-indexeddb). For one-off verification:

```sh
pnpm add -D playwright@1.61.1   # temporary
# write a .mjs script INSIDE the project dir (node_modules resolution
# needs the script's own path to be under the project tree — a script in
# /tmp or the scratchpad can't resolve `import "playwright"` even with cwd set)
node /Users/jpr/dev/rushsoft/clockout/.tmp-verify.mjs
rm /Users/jpr/dev/rushsoft/clockout/.tmp-verify.mjs
pnpm remove playwright
git restore pnpm-lock.yaml   # `pnpm remove` can leave transitive drift
                              # (e.g. remix's optional peer dep on playwright)
                              # in the lockfile; restore + `pnpm install
                              # --frozen-lockfile` to get back to clean
pnpm install --frozen-lockfile
```

Chromium is already cached at `~/Library/Caches/ms-playwright` on this
machine, so `chromium.launch()` works without a separate browser install
step.

## Flow to drive

1. Load `/` → setup form (weekly/daily target fields, password + repeat,
   "Speichern und los ..." button, disabled until passwords match).
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
