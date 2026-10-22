# Hand-off notes

Snapshot for continuing work on another machine. See `README.md` (features, AI routes, layout,
known limitations) and `AGENTS.md` (framework rules, API contracts, DB/auth) for architecture.
Items marked "unverified" were reported by the previous session and not re-checked in code.

## Where we are

EmbedPath is a single-user Next.js + Postgres (Drizzle) learning app for embedded engineers.
Claude CLI or Copilot CLI (selectable, see below) on the host writes the lessons and questions. Built so far:

- `lib/taxonomy.ts` as the single source of domains/topics/sub-topics.
- Topic lessons with adapted variants, "Ask about this", a retrieval check and a transfer exercise.
- Topic-specific practice, with later exercises cached as `practice:<n>` and generated lazily.
- Assessments graded server-side (`/api/assessment/grade`), which updates `topic_mastery` and returns `mastery_delta` feedback.
- Resume and restart of in-progress assessment sessions.
- Coherence checks plus an LLM judge pass for generated questions.
- Six domains: C, C++, Linux, Networking, BSP and **QNX** (15 topics; 83 topics in total after the taxonomy expansion, see open work item 2). The diagnostic plans one question per domain. `DOMAIN_ORDER` and the grade labels derive from `lib/taxonomy.ts`.
- Hardening: `/api/claude` takes only `{ message }` (no answer key reaches a prompt); registration closes after the first account (`ALLOW_REGISTRATION=true` reopens it); 30 Claude spawns per learner per minute and 4 at once; routes log the real error and return a generic message; every spawn logs `purpose`, duration and result.
- Lessons: lecture generation has a 240 s timeout; the transfer exercise must be self-contained and answerable in text; retrieval/transfer prompts render fenced code, lesson examples render as preformatted code.
- Questions are written one ahead of the learner (see open work 1).

All of this is committed locally; check `git status` and `git log origin/main..` and push before switching machines.

## How to continue on another machine

- Prerequisites: Node.js 20, PostgreSQL 14+, `claude` CLI on `PATH` and logged in (`claude auth status`).
- Env (in git-ignored `.env.local`): `DATABASE_URL`, `DATABASE_PROVIDER=postgres`, `APP_JWT_SECRET`; optional `ALLOW_REGISTRATION=true`. Values: see README "Setup". `.env.local` is not in git, so recreate it.
- The database does not travel with git: lessons, assessments and mastery stay in the old machine's Postgres. A new machine starts empty (register the first account, the seed runs on first load). To carry the data over: `pg_dump "$DATABASE_URL" > embedpath.sql` there, `psql "$DATABASE_URL" < embedpath.sql` here (after creating the database).
- On WSL keep the repo on the Linux filesystem or run `WATCHPACK_POLLING=true npm run dev`; under `/mnt/<drive>` file changes are not detected, which caused several "I fixed it but the browser still shows the old thing" rounds.
- First run after pulling: restart the dev server (taxonomy, schema and route changes are not hot-reloaded reliably), then Ctrl+F5.
- Install and migrate: `npm install`, then `npm run db:migrate`.
- Run: `npm run dev` (port 3333); production build: `npm run build`.
- Check types: `npm run typecheck`. There is no test suite.
- Tooling caveats: ESLint config is currently broken (circular JSON error; `npm run lint` also uses `next lint`, removed in Next 16). The `code-review-graph` index produced 0 nodes in the previous environment. Neither is an app bug.

## AI provider setting (Claude CLI / Copilot CLI)

Profile page -> "AI provider" (segmented control, status, failover checkbox, Test connection). Code: `lib/ai-cli.ts`
(providers, failover), `lib/ai-settings.ts` (setting + availability), `lib/json-schema-lite.ts`, `app/api/settings/ai/route.ts`.
Env and caveats: README "AI provider setting". `runClaudeJson` keeps its signature; `topic_lessons.model` now holds
`servedModel(result)`. Checked with a real logged-in Copilot 1.0.102 on 2026-10-22 (about 13 real Copilot calls + 1 real Claude call):

- Verified: JSONL shape (sample: scratchpad `real/sample-redacted.jsonl`): the answer is the last `assistant.message` event
  (`data.content`); deltas are `assistant.message_delta`; a final `{"type":"result","exitCode":0,"usage":{"premiumRequests":1,...}}`.
  Each call costs 1 premium request on the default model. A tool turn emits an earlier `assistant.message` with empty content, so the parser takes the last non-empty one.
- Verified, and it changed the flags: `--available-tools=` (empty) does NOT disable tools; the model ran `echo` and read a file.
  `--available-tools=none` (an unknown name) does disable them; `--available-tools ""` does not. The code uses `=none`.
- Verified: `--model auto` and `--model claude-haiku-5.5` work; default model was `claude-sonnet-5.5`. Ids listed by `copilot help config`
  include claude-sonnet-5(.5), claude-opus-5(.5), claude-haiku-5.5, gpt-5.4-mini, gpt-6-*, gemini-*, grok-*. No premium multiplier was shown in the JSON output (only `totalPremiumRequests`).
- Verified: not logged in (empty `COPILOT_HOME`, no token) prints "No authentication information found." on stderr, exit 1, in about 1.5 s; the app maps it to 503 "Copilot is not logged in...".
- Verified: tiny call 5-7 s (startup dominated); schema-based practice exercise (PRACTICE_SCHEMA, about 9 KB output) 31 s; lecture (LECTURE_SCHEMA, about 7 KB) 24 s. Both validated on the first try, so 0 repair retries in 2 medium/large samples (too few to estimate a rate).
- Verified: two parallel spawns with the shared `~/.copilot` both succeeded; no errors seen (with only two samples, a collision under heavier load is not ruled out).
- Verified with a fake `copilot` (scratchpad `fake-copilot/`): success, fenced JSON, repair retry, invalid twice -> 502, quota 402/429 -> 429, auth -> 503, timeout with group kill of a grandchild, ENOENT -> 503, per-call failover. Settings GET/PUT persisted via the running app; Test connection worked for both real providers.
- Model setting (2026-10-22, simplified): one Model dropdown (Default / list / "Other…" free text) per selected provider, stored `preferences.ai_model = {claude, copilot}`, used for every call; resolve in `lib/ai-settings.ts` (profile > `CLAUDE_MODEL`/`COPILOT_MODEL` > default). Lists in `lib/ai-models.ts`: Claude = aliases fable/opus/sonnet/haiku (auto-latest, verified `haiku` -> claude-haiku-5-5) + ids (live from /v1/models only if ANTHROPIC_API_KEY, else built-in); Copilot live from `copilot help config` (cache 10 min, `?refresh=1`, hard-coded fallback; fix `parseCopilotModels` if the format changes). `GET` returns `models.<p> = {options, source, updated_at}`; answers record the resolved id from `modelUsage`. No inference. Verified ids: claude `claude-haiku-5-5`, copilot `claude-haiku-5.5` / `auto`. Failover uses the other provider's own value. Future idea, not built: per-purpose model.
- Still unverified: quality of Copilot lessons against Claude's (no side-by-side done); a full-size 110 s class lecture on Copilot; behaviour under quota exhaustion with the real service (only simulated errors); how the model reacts when asked for a tool-requiring task with tools off (it printed pseudo tool calls as text); visual check of the profile card in a browser; whether `GH_TOKEN` in the server environment changes which account Copilot uses.

## Assessment history, review and retake
- Why topic-only had no history: the History tab only listed rows of the `attempts` table (code exercises). Quiz grading writes `assessment_responses` / `learning_events` and never an attempt, so NO assessment (topic-only, custom or diagnostic) ever appeared. Fix: `GET /api/assessment/history` + `app/sections/assessment-history.tsx` (list with filters, review view); old sessions appear without migration.
- Review view is also opened from the result screen ("Review answers"). Buttons: "Retake this topic/these topics" (fresh questions, `fresh: true` path of startAssessment), "Retry the same questions" (`review_retake` session, mastery policy: no effect), "Resume" for in-progress sessions.
- Home has a "Code practice" card (recommended topic = weakest assessed topic < 70, else last touched; recent code exercises; Continue/Practice again reopens the topic's newest cached exercise via openTopicPractice, since attempts only store the lesson activity id). Assessment results no longer offer "Retry without hints" (it opened the code workspace); practice results keep "Retry this exercise".
- Deferred: per-question time is not recorded (`response_time_ms` is 0); the History assessment list filters client-side over loaded pages; Home "Recent attempts" titles are long prompts (pre-existing).

## Open work / next steps (priority order)

1. **Questions are written one ahead (implemented, unverified in a browser).** `generateSlots` in `app/page.tsx` parks its workers until the learner has reached the slot before (`frontierRef`, `reachSlot`), so start and resume no longer write every slot at once and leaving early costs at most one unopened question. Manual retry (`retryMissing`) is eager. Check by hand: start a 5-question diagnostic and watch the log for `purpose=assessment/generate` (one call, then one more per question reached); resume a half-finished session; jump to a not-yet-written slot from the coverage panel; "Save & next" on the last written slot. `pending` still counts unwritten slots, so some "still being written" toasts now cover a slot that has not started.
2. **Review the QNX content (new, unreviewed).** The 15 QNX topics and their sub-topics in `lib/taxonomy.ts` were written from general QNX Neutrino knowledge, not checked against the QNX docs for the version you use (7.0 / 7.1 / Safety). Open each topic's lesson and compare. The taxonomy was also expanded from 63 to 83 topics (automotive CAN/Ethernet/SOME-IP/DoIP, cellular, IPv6, Yocto/OTA/secure boot, PREEMPT_RT, containers, C/C++ memory models, QNX adaptive partitioning/hypervisor/ISO 26262); the automotive, cellular and new QNX topics are likewise unverified against vendor docs or standards. Known doubt: what `slay -f` does (one generated example used it). Network (`io-pkt` vs `io-sock`) and filesystem topics are the most version-dependent. The first generated QNX example was a weak ASCII diagram, not a worked example: consider a lecture-prompt rule that examples must use real commands/API names of the domain and trace one call step by step.
3. **Legacy retrieval path leaks `answer_rule`.** `handleRetrievalSubmit` / `handleLectureAction` in `app/page.tsx` (plus `hooks/use-lesson.ts`, `app/sections/result-section.tsx`) send `review.lecture.retrieval_check.answer_rule` through `/api/claude`. Low risk for single-user (the answer-key leak through `/api/claude` itself is fixed). Move grading server-side like `/api/lesson/transfer` with `kind: 'retrieval'`, then drop the legacy handlers if unused.
4. **Question generation (`app/api/assessment/generate/route.ts`, `lib/assessment-validate.ts`).**
   - `judgeCoherence` stays fail-open on purpose (a failed judge call must not discard a question that passed the heuristics); it now logs a warning and stores `validation_evidence.judge` on the item: `{status: not_needed|passed|skipped, coherent, ambiguous, alt_correct_option, unstated_assumption, strawman_options, regenerated}` (lib/assessment-judge.ts; judged: any question with an artifact, design pair or "best fits/most likely" wording).
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
11. **Transfer prompt wording.** One generated transfer exercise ended with an ambiguous sentence ("the way the second test was probably meant"). Add a prompt rule that the last sentence states only what the learner must do. Regenerating a lesson also deletes its practice rows (see 6).
12. **Security leftovers.** Registration is only closed after the first account, so a second machine or user needs `ALLOW_REGISTRATION=true`. The rate limiter is in process memory (not shared across instances). Cookie is `SameSite=None; Secure` in production and mutating routes do not check `Origin` (matters only if the app runs in a cross-origin iframe). Generic CRUD routes still accept arbitrary fields on PATCH (`owner_user_id` is ignored by `scopedRepo`, but a learner can write their own `topic_mastery.score`). `access-check` fails open when `ARCHITECT_BACKEND_URL` / `APP_ID` are missing.
13. **Legacy review view.** `app/sections/result-section.tsx` still renders the retrieval prompt as plain text (no code fences) and belongs to the legacy path in 3.
14. **No automated tests.** Cheapest wins: `lib/assessment-validate.ts` and `lib/rate-limit.ts` (pure functions).

## Testing notes

No automated tests. Previous verification used a throwaway local Postgres and headless Chromium. Re-check after changes:

- Grade idempotency (repeat submit returns `replayed: true`, mastery applied once) and `mastery_delta`.
- Session resume and restart.
- Lazy practice generation and "Start next exercise".
- Ask -> Update lesson (adapt) flow.
- Transfer and retrieval submit.
- Layout at 390px width.
