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

30. Always show a per-day weekly breakdown; add "did not work" checkbox
    `(add weeklyBreakdown + skipDay event type; wire checkbox in app.tsx)`

31. Merge catch-up form into the breakdown: any blank day gets inline fields
    `(add weeklyEntryDays; resolveCatchup matches day0 by date; app.tsx)`

32. Exclude a stale (pre-today) open session's bleed from today too
    `(edit time-tracking.ts: staleOpenSessionOverlap; examples.ts; tests)`

33. Add configurable dateFormat (de/iso/auto) to setup form, default "de"
    `(add date-format.ts; dateFormat in TrackingSettings; setup <select>)`

34. Add i18n: hash-keyed t(), dev-time sync script, Accept-Language detect
    `(add i18n.ts/de.ts/i18n-sync.ts; t() in app.tsx/document.tsx/about.tsx)`

35. Add pnpm check gate: fail if any t() string isn't synced/translated
    `(add --check to i18n-sync.ts; wire into package.json's check script)`

36. Translate example titles (About page links, demo banner)
    `(t(example.title) in about.tsx/app.tsx; extract EXAMPLES in sync script)`

37. Use a fixed-width font for the read-only weekly data rows
    `(add .data-row class in app.css; apply in app.tsx breakdown list)`

38. Fix catch-up days reappearing/auto-resolving; only answered days save
    `(edit time-tracking.ts: weeklyEntryDays event check; skip flags; app.tsx)`

39. Add a permanent Playwright e2e suite (adopts the new global standard)
    `(pnpm add -D playwright @playwright/test; config + tests/e2e.spec.ts)`

40. Fix: skipping a later catch-up day no longer force-resolves an earlier
    `(edit time-tracking.ts: danglingStart() replaces lastEvent checks; tests)`

41. Weekends are exempt from mandatory catch-up & default weekly display
    `(edit time-tracking.ts: weekend-aware catchupDays/entryDays/breakdown; tests)`

42. Add "Forgot to stop on Friday" example, demoing the weekend catch-up
    `(add example to examples.ts; translate title in de.ts via i18n:sync)`

43. Pre-check "Did not work" on catch-up weekend days (Friday stays open)
    `(edit app.tsx: defaultChecked/disabled by day.getDay() in weekList)`

44. i18n: key translations by source text directly, drop the FNV-1a hash
    `(edit i18n.ts/i18n-sync.ts/de.ts; update global webapp-paradigms i18n.md)`

45. Site shell: corporate-default header/footer (own brand, github differs)
    `(add navbar.tsx/footer.tsx; edit document.tsx/app.css; i18n:sync)`

46. PWA setup: manifest, service worker, apple touch/splash icons wired in
    `(add sw.ts; edit assets.ts/routes.ts/controller.tsx/document.tsx/entry.ts)`

47. Style setup/unlock forms with radix tokens; password-first + field hints
    `(edit app.css: form/btn styles; edit app.tsx: reorder + hint copy; i18n)`

48. Harvest "hint/error slot below input" pattern into paradigms + skill
    `(add paradigms.md #2; edit global webapp-paradigms forms.md/SKILL.md)`

49. Pre-generate doc id + hidden username field for password manager autofill
    `(edit time-tracking.ts: id param; app.tsx: sr-only username; app.css)`

50. Persist derived sync key so reopening the app never re-asks for password
    `(split key-derivation from encrypt/decrypt; add sync-key IDB store)`

51. Coalescing sync engine: abort-superseded + gen-counter + backoff retry
    `(add app/utils/sync-engine.ts, adapted from shopping-list2's pattern)`

52. Fix: dev server never picked up file edits (watch:false meant for prod)
    `(edit assets.ts: watch: false -> watch: isDevelopment)`

53. Adopt Open Props tokens for border-size/spacing/duration (drop 2 dead vars)
    `(pnpm add open-props; @import in app.css; also dropped dead --color-border)`

54. Extend Open Props coverage: font-weight/line-height/z-index/font-sans
    `(add fonts.min.css/zindex.min.css imports; skip risky --font-mono swap)`

55. Style the about page and add an intro paragraph explaining clockout
    `(edit about.tsx/app.css/de.ts: intro copy + card-style example list)`

56. Style the tracking screen; make Start/Stop and Save hours prominent
    `(edit app.tsx/app.css: stat card, full-width toggle button, week-list)`

57. Fix catch-up row spacing (hm-row/unit + labeled skip checkbox in-row)
    `(edit app.tsx/app.css: reuse hm-row/unit, add .catchup-skip)`

58. Add Lighthouse quality gate (perf>=80, a11y/bp/seo>=90) across pages
    `(pnpm add -D lighthouse; add scripts/lighthouse.ts; wire test:quality)`

59. Fix missing input labels found by the new a11y gate (home page 94->100)
    `(edit app.tsx: aria-label on weekly/daily/catch-up hour+minute inputs)`

60. Select number-input value on focus so keyboard entry overwrites it
    `(edit app.tsx: mix={on("focus", ...select())} on all h/m inputs)`

61. Stop @import-chaining Open Props CSS; link all 6 files in parallel
    `(edit app.css/document.tsx: 5 <link> tags before app.css, same order)`

62. Lunch break example: add a full Monday+Tuesday (16h) before the demo day
    `(edit examples.ts: 2 start/stop pairs; fix event-count test)`

63. Right-aligned "Today" chip on the week-list row matching the current day
    `(edit app.tsx/app.css/de.ts: today-chip span, startOfDay comparison)`

64. Move Start/Stop (and Save hours) to the bottom of the screen for thumb reach
    `(edit app.tsx: TrackingScreen renders week-list/catchup-form before button)`

65. Fix Safari "invalid sourceRoot" warning (lightningcss emits null, not absent)
    `(edit assets.ts/controller.tsx: fetchAsset strips null sourceRoot from .map)`

66. Console-guard fixture: any warning/error/pageerror fails the e2e test
    `(edit e2e.spec.ts: base.extend page override; update verify skill)`

67. Fix today-chip contrast (3.25:1 on primary-9) caught by the a11y gate
    `(edit app.css: reuse .btn-coffee's darker literal blue, now 5.72:1)`

68. Inline edit for an already-recorded day: pencil icon -> h/m fields -> save
    `(add editDay "adjust" event to time-tracking.ts; wire into app.tsx/css)`

69. Input validation audit: password strength, sync payload/body size caps
    `(edit app.tsx: minLength=8 on setup password; sync/controller.tsx: caps)`

70. Source maps: tried dropping entirely, reverted (broke @remix-run/ui maps)
    `(assets.ts: keep sourceMaps on, keep the fixed fetchAsset wrapper)`

71. SW: never intercept .map requests — real root cause of lingering errors
    `(edit sw.ts: return early on url.pathname.endsWith(".map"))`

72. Reword full history to Conventional Commits; add a skill to keep it so
    `(filter-branch --msg-filter reword.sh -- main; add conventional-commits skill)`

73. Real navigation on setup/unlock + Credential Management API for save-password
    `(edit app.tsx/sync-engine.ts: navigate post-sync; add password-credential.d.ts)`

74. Fix ClockOut brand casing: title, manifest, About heading, alt text, README
    `(edit document.tsx/controller.tsx/navbar.tsx/about.tsx/app.tsx/de.ts/README.md)`

75. Add version-update banner + Add-to-Home-Screen hint (site default pattern)
    `(add /api/version, SW_UPDATED/CO_FORCE_FRESH; edit entry.ts/sw.ts/app.css/de.ts)`

76. Add tag-triggered deploy pipeline (site default recipe, no DB/Prisma step)
    `(add .github/workflows/deploy.yml; edit .dockerignore)`

77. Replace scaffold README with an actual description of ClockOut
    `(edit README.md: features, pnpm commands, real layout, deploy)`

78. Add release:patch/minor/major scripts to trigger the deploy tag
    `(edit package.json/README.md/CLAUDE.md: pnpm version + push + tags)`

79. Backfill is fully data-driven; hide Start/Stop until week is answered
    `(edit time-tracking.ts/app.tsx/*.test.ts/e2e.spec.ts: guard + toggle gate)`

80. Settings screen from home; fix PWA 100vh layout bug; numeric keypad
    `(edit app.tsx/app.css/de.ts/e2e.spec.ts: settings view, dvh, inputmode)`

81. Redesign spec: drop weekly model for day/block/depot + Feierabend time
    `(edit requirements.md: replace weekly target/breakdown with new model)`

82. Rewrite core data model: day blocks + depot + Buchung/Feierabend calc
    `(rewrite time-tracking.ts + time-tracking.test.ts for the new model)`

83. Migrate tracking-document.ts payload to blocks/bookings; keep English idents
    `(edit tracking-document.ts + 2 test fixtures; rename Buchung/feierabendSec)`

84. Rewrite app.tsx for the new model: setup/settings + block/booking UI
    `(edit app.tsx/app.css/de.ts: daily-minimum config, blocks, Buchen form)`

85. Rewrite demo examples for the block/depot model; fix stale app-copy
    `(rewrite examples.ts/examples.test.ts; update about/manifest copy+i18n)`

86. Rewrite e2e.spec.ts for blocks/Buchen; fix stale lighthouse example URL
    `(rewrite e2e.spec.ts; edit lighthouse.ts + verify skill flow section)`

87. Validate booking time <= daily max; native tooltip error (req #11)
    `(edit app.tsx: syncBookingTimeValidity on h/m inputs; e2e.spec.ts; de.ts)`

88. Move Buchungszeit/Buchen form to page bottom, below sync status
    `(edit app.tsx: reorder booking-form after footer in TrackingScreen)`

89. Fix: pin booking form to page bottom via flex, not just DOM order
    `(edit app.css: .time-page flex:1, .booking-form margin-top:auto)`

90. Drop per-block duration; center block-row and booking-time inputs
    `(edit app.tsx/app.css: rm .block-duration span+rule; hm-row centering)`

91. Shrink number/time inputs to content width; drop time picker icon
    `(edit app.css: input[number] 2.5rem, input[time] 3.25rem, no icon)`

92. Booking tops up short days from depot; drawdown decreases it (req11)
    `(edit time-tracking.ts: defaultBookingSec/bookDay; app.tsx; tests)`

93. Block edits commit via form submit, not per-keystroke change
    `(add applyBlockEdits; app.tsx: block-form + Save button; tests)`
