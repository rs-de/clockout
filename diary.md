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
