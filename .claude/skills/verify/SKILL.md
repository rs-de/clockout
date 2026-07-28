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

## Console must be clean — always check, zero tolerance

`tests/e2e.spec.ts` overrides the `page` fixture (`base.extend`) so every
test fails on any `console` warning/error or `pageerror`, not just the ones
a test happens to assert on. This is a permanent regression guard, not a
one-off check — it caught nothing by luck; it's *supposed* to catch things.
Keep this fixture when adding new tests; don't work around it by using the
un-overridden `page` from `@playwright/test` directly.

The same standard applies to manual/exploratory Playwright driving (see
below): always attach `page.on("console", ...)` and `page.on("pageerror",
...)` and report what they captured, even for a "just take a screenshot"
pass. A clean console is part of "the change works," the same as a passing
test — don't wait for it to be reported. Warnings are engine-specific (a
sourceRoot issue once surfaced only in WebKit, not Chromium), so check both
`chromium` and `webkit` when verifying anything that touches served assets.

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
when done — no need to install/remove the package anymore. Always wire up
the console guard, e.g.:

```js
const page = await browser.newPage()
page.on("console", (msg) => {
	if (msg.type() === "warning" || msg.type() === "error") {
		console.log(`${msg.type()}: ${msg.text()}`)
	}
})
page.on("pageerror", (err) => console.log(`pageerror: ${err.message}`))
```

## Flow to drive

1. Load `/` → setup form (daily minimum/max fields, password + repeat,
   "Save and start tracking" button — English by default; German only
   when the request's `Accept-Language` resolves to `de`).
2. Submit → creates a `TrackingData` doc, saves to IndexedDB, switches to
   the tracking screen (quitting-time estimate, depot, a block list,
   Start/Stop toggle, a Buchen booking form).
3. Click Start/Stop → fills the active block's start/end with the current
   time; a completed block auto-appends a new empty one. A block's time
   inputs are also directly editable (type "09:00"/"17:00" + `change`) —
   the fast way to test a full multi-hour session without waiting for real
   time to pass.
4. Submit the booking form (defaults to worked time, capped at the daily
   max) → banks time over the daily minimum into the depot, resets to a
   single empty block.
5. Reload → should land straight back on the tracking screen with state
   intact (no password re-entry) — this is the point of the IndexedDB
   local-store layer.
6. To inspect raw persisted state: `page.evaluate` against
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
