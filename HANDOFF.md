# Hand-off notes

Snapshot for continuing work on another machine. See `README.md` (features, AI routes, layout,
known limitations) and `AGENTS.md` (framework rules, API contracts, DB/auth) for architecture.
Items marked "unverified" were reported by the previous session and not re-checked in code.

## Where we are

EmbedPath is a single-user Next.js + Postgres (Drizzle) learning app for embedded engineers.
Claude CLI on the host writes the lessons and questions. Built so far:

- `lib/taxonomy.ts` as the single source of domains/topics/sub-topics.
- Topic lessons with adapted variants, "Ask about this", a retrieval check and a transfer exercise.
- Topic-specific practice, with later exercises cached as `practice:<n>` and generated lazily.
- Assessments graded server-side (`/api/assessment/grade`), which updates `topic_mastery` and returns `mastery_delta` feedback.
- Resume and restart of in-progress assessment sessions.
- Coherence checks plus an LLM judge pass for generated questions.

## How to continue on another machine

- Prerequisites: Node.js 20, PostgreSQL 14+, `claude` CLI on `PATH` and logged in (`claude auth status`).
- Env (in git-ignored `.env.local`): `DATABASE_URL`, `DATABASE_PROVIDER=postgres`, `APP_JWT_SECRET`. Values: see README "Setup".
- Install and migrate: `npm install`, then `npm run db:migrate`.
- Run: `npm run dev` (port 3333); production build: `npm run build`.
- Check types: `npm run typecheck`. There is no test suite.
- Tooling caveats: ESLint config is currently broken (circular JSON error; `npm run lint` also uses `next lint`, removed in Next 16). The `code-review-graph` index produced 0 nodes in the previous environment. Neither is an app bug.

## Open work / next steps (priority order)

1. **Resume generates every missing slot.** `resumeAssessment` / `startAssessment` in `app/page.tsx` fill all missing slots on load. A 3-slot assessment can cost 3-6 Claude calls (generate + judge + retry). Decide: generate only the next slot lazily.
2. **Spawn observability.** `lib/claude-cli.ts` (`spawnClaude`) does not record which route/purpose started a spawn, so stray calls could not be attributed. Log route, purpose, duration and exit code per spawn.
3. **Legacy retrieval path leaks `answer_rule`.** `handleRetrievalSubmit` / `handleLectureAction` in `app/page.tsx` (plus `hooks/use-lesson.ts`, `app/sections/result-section.tsx`) send `review.lecture.retrieval_check.answer_rule` through `/api/claude`. Low risk for single-user. Move grading server-side like `/api/lesson/transfer` with `kind: 'retrieval'`, then drop the legacy handlers if unused.
4. **Question generation (`app/api/assessment/generate/route.ts`, `lib/assessment-validate.ts`).**
   - `judgeCoherence` accepts a question when the judge call itself fails (fail-open). Decide fail-open vs fail-closed.
   - The A/B coherence heuristic only fires when the stem names the designs in backticks.
   - The original switch-vs-table bad item (id starting `26a67`) was never reproduced with the new prompt.
   - The difficulty-rationale prompt change (at most 2 generic bullets) is untested with real Claude.
   - Server-side retrieval grading (`/api/lesson/transfer`, `kind: 'retrieval'`) was tested only with mocks.
5. **Mastery design.** Only `/api/assessment/grade` changes `topic_mastery` (score moves toward evidence, max +/-8 per answer; bands at 40 and 70 in the same route). Practice, transfer, retrieval and ask do not. Decide whether they should contribute a little (suggestion: +2/+3 only on "correct"). The toast `+8 (24)` in `app/page.tsx` reveals correctness mid-session; decide whether to hide it until the session ends.
6. **"Start next exercise".** `next` in `app/api/lesson/route.ts` writes `practice:<n+1>` only when the newest practice has a completed attempt; finishing an assessment does not count. Decide if it should. Regenerate deletes `lecture*` and `practice*` rows while old attempts still reference the old activity ids.
7. **UX leftovers.**
   - Skill Map "Start lesson" / "Assess" live in the selected-topic panel, not per row (by design, nested buttons).
   - Home "recent practice" (`openRecentPractice`) is untested in a browser.
   - Hint reveal state is client-only and resets on reload.
   - `attempts` has no `topic_id` column; topic is inferable only from `activity_id` (`lesson-<domain>-<topic>[-pN]`).
   - Header streak (`lib/home-recommendation.ts`) uses the browser's local timezone.
   - Retrieval, ask and transfer results are not shown in History.
8. **Data model.** All `topic_lessons` rows, including `lecture:adapted`, are shared, not per user (fine for single-user; needs owner scoping for multi-user). Old rows with obsolete ids remain unused. After taxonomy edits, regenerate `scripts/cleanup-topic-mastery.sql` with `npx tsx scripts/gen-cleanup-topic-mastery.ts` and run it by hand with `psql` (see README "Taxonomy maintenance").
9. **Cleanup candidates.** `plan-handoff/prd.md` still describes "Explain more" and a Lyzr hosted agent; update or remove. Unverified: removing the fetch interceptor dropped the automatic `Authorization: Bearer` header, so auth relies on the `auth_token` cookie (only matters inside cross-origin iframes).
10. **Seed / restart.** The user seed uses the first taxonomy topic per domain. "Start a new assessment instead" only matters when several in-progress sessions exist for the same scope.

## Testing notes

No automated tests. Previous verification used a throwaway local Postgres and headless Chromium. Re-check after changes:

- Grade idempotency (repeat submit returns `replayed: true`, mastery applied once) and `mastery_delta`.
- Session resume and restart.
- Lazy practice generation and "Start next exercise".
- Ask -> Update lesson (adapt) flow.
- Transfer and retrieval submit.
- Layout at 390px width.
