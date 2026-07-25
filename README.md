# ClockOut

A lean, private time tracker: clock in, clock out, and see at a glance how
much time is left today and this week.

- **No account.** Data lives in the browser (IndexedDB), identified by a
  random id in the URL — bookmark it to come back.
- **Encrypted before it ever leaves the browser.** A password derives the
  sync key (PBKDF2 → AES-GCM, Web Crypto); the server only ever stores
  opaque ciphertext, so it can recover your data if local storage is
  cleared without being able to read it.
- **Event-sourced.** Everything (worked time, catch-up entries, manual
  edits) is an append-only event; every total is derived from that log on
  the fly — no rewritten history.
- **Installable PWA.** Works offline via a service worker, prompts to save
  the derived password, and offers itself for the home screen.
- **English and German**, resolved from the browser's `Accept-Language`.

See [`requirements.md`](requirements.md) for the full behavior spec and
[`paradigms.md`](paradigms.md) for patterns worth reusing elsewhere.

## Commands

```sh
pnpm install        # install dependencies
pnpm dev            # start dev server
pnpm start          # production server
pnpm test           # run all tests (unit + e2e + quality)
pnpm test:unit      # unit tests (Node built-in runner)
pnpm test:e2e       # Playwright e2e suite (tests/e2e.spec.ts)
pnpm typecheck      # tsc --noEmit
pnpm check          # Biome lint + format + i18n check (auto-fix)
```

## Layout

- `app/actions/controller.tsx` — top-level route actions (pages, manifest,
  service worker, version endpoint).
- `app/actions/sync/controller.tsx` — the encrypted-document sync endpoint
  (`GET`/`PUT /sync/:id`).
- `app/data/sync-store.server.ts` — file-based storage for synced
  ciphertext, one JSON file per document.
- `app/middleware/render.tsx` — request-scoped renderer used by actions.
- `app/ui/` — document shell, tracking/setup/unlock screens, About page.
- `app/utils/` — pure logic: event log + time math, crypto, i18n, sync
  engine, examples.
- `app/i18n/` — generated German dictionary (`pnpm i18n:sync`/`i18n:check`
  keep it honest against `t()` call sites).
- `app/assets.ts` / `app/assets/` — asset pipeline, client entry (SW
  registration, update/install banners), service worker.

## Deploy

Single Fly.io host with a persistent volume for the sync store (no managed
database — the store is schemaless files). `.github/workflows/deploy.yml`
gates a deploy on typecheck/lint/i18n-check/unit tests, then runs on every
`v*` tag. Cut a release with:

```sh
pnpm release:patch   # or release:minor / release:major
```

Bumps `package.json`'s version, commits, tags, and pushes both — the tag
is what triggers the pipeline above.
