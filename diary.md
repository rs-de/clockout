# Build Diary — clockout

Pre-diary: `npx remix@next new clockout`, pnpm, pnpm install (baseline)
Pre-diary (retroactive): register scaffolded Remix skill for Claude Code
   `ln -s ../../.agents/skills/remix .claude/skills/remix`

---

1. Initialize git repository and record build diary
   `git init && git add -A && git commit -m "chore: initial remix3-beta install"`

2. Pin devDependency versions, tighten engines field
   `(edit package.json: @types/node 26.1.1, typescript 7.0.2, engines >=24)`

3. Align tsconfig lib to match target
   `(edit tsconfig.json: lib ES2024 -> ESNext to match target ESNext)`

4. Strip scaffold demo, reduce to hello world page
   `(delete scaffold-home-page.tsx, prompt-button.tsx; simplify controller.tsx)`

5. Add Biome as linter/formatter with VSCode integration
   `(add @biomejs/biome, biome.json, .vscode/settings.json, lint/format/check scripts)`

6. Add CLAUDE.md with diary workflow, fix AGENTS.md commands
   `(create CLAUDE.md, update AGENTS.md npm -> pnpm)`

7. Event-log types + pure Tages-/Wochen-Restzeit calculation utilities
   `(add app/utils/time-tracking.ts + test/time-tracking.test.ts)`

8. Fix requirements.md numbering, translate to English
   `(edit requirements.md: renumber duplicate "1)", fix typos, translate)`

9. Add nanoid document id to TrackingData (whole history resource, not per-event)
   `(pnpm add nanoid; add id + createTrackingData(); dailyMaxMin -> dailyMax)`

10. Password-derived encryption (PBKDF2 -> AES-GCM) via Web Crypto
    `(add app/utils/crypto.ts + test/crypto.test.ts)`

11. Wire encryption to TrackingData: encrypt/decrypt whole document
    `(add app/utils/tracking-document.ts + test/tracking-document.test.ts)`

12. Local IndexedDB persistence for TrackingData (decrypted, durable write-buffer)
    `(pnpm add -D fake-indexeddb; add app/utils/local-store.ts + tests)`

13. Setup + tracking screens; plain CSS (no CSS-in-JS); widen asset allowlist
    `(add app/ui/app.tsx, app/assets/app.css; fix SSR-crashing setInterval)`

14. Persist browser-verification recipe learned while checking step 13
    `(add .claude/skills/verify/SKILL.md: launch/drive steps, gotchas)`

15. Server-side sync storage for encrypted documents (no crypto server-side)
    `(add app/data/sync-store.server.ts, /sync/:id GET+PUT route+controller)`

16. Wire client to push encrypted syncs after setup/toggle; show sync status
    `(edit app/ui/app.tsx: session-scoped password, fetch PUT /sync/:id)`

17. Recovery flow: bookmarkable /d/:id, unlock screen after storage cleared
    `(add doc route+action, unlock view, history.replaceState on setup)`

18. Fly.io deploy config (single host, volume-backed sync store)
    `(add Dockerfile, .dockerignore, fly.toml; pin packageManager)`

19. Catch-up flow: backfill forgotten stop with per-day hours (req #9)
    `(add catchupDays/resolveCatchup; add catchup form to app.tsx + tests)`

20. Extend catch-up to also cover multi-day gaps after a clean stop (req #9)
    `(edit requirements.md #9; generalize catchupDays/resolveCatchup + tests)`

21. Never disable submit for live validation; validate on submit instead
    `(edit app.tsx setup form; add paradigms.md with this pattern)`

22. Setup form: stateless cross-field validation via setCustomValidity
    `(drop password/passwordRepeat/submitAttempted state; native validity)`

23. Always show the most recent session's start time (req #7)
    `(add startedAt to TrackingSummary/summarize; render in app.tsx)`

24. Discard start/stop pairs under 1 minute as accidental taps (req #10)
    `(add toggleTracking/MIN_SESSION_SEC; wire into handleToggle + tests)`

25. Offset-based event resolver, foundation for demo examples + QA fixtures
    `(add resolveRelativeEvents/RelativeEvent to time-tracking.ts + tests)`

26. "About" page + in-memory example demos, seeded via /example/:id (req #11)
    `(add examples.ts, about.tsx, /example+/about routes; wire app.tsx + tests)`

27. Site-wide footer linking to About; simplify About to just links
    `(edit document.tsx: add <footer>; edit about.tsx: drop prose)`

28. Fix: chain catch-up sessions sequentially (fixes wrong weekly total)
    `(edit resolveCatchup: chain days instead of midnight-anchoring; tests)`

29. Day-remaining floors at 0 once the week's target is already met (req #12)
    `(edit summarize: floor dailyRemainingSec unless today itself overruns)`
