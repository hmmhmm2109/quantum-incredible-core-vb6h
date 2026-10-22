# EmbedPath

An adaptive, practice-first tutor for embedded-systems engineers. It covers six domains
(C, C++, Linux, Networking, BSP, QNX) and tracks a separate mastery level per domain and topic.

**Domain level** = the average score across ALL topics of the domain (weight 1 each; a topic that is not assessed counts as 0), banded <40 Basic, <70 Intermediate, otherwise Advanced. Home and Skill Map also show "Assessed X of M", the weakest assessed topic and the assessed-only average, and a "Provisional" badge while fewer than half the topics are assessed. The overall level is the same mean over all 83 topics. Topic-level scores and bands are unchanged. Logic: `lib/domain-score.ts`; check: `npx tsx scripts/check-domain-score.ts`.

Everything the AI writes (assessment questions, lessons, practice exercises, coaching feedback)
is produced by **Claude CLI running on the host machine**, using that machine's existing
Claude login. The app never asks for or stores an Anthropic API key.

## What it does

| Feature | How it works |
|---|---|
| **Mixed diagnostic** | Claude writes 5 fresh multiple-choice questions (one per domain) on a random taxonomy topic and sub-topic, with random difficulty and angle. Question 1 appears first; the rest are written in the background. |
| **Topic assessment** | Pick one topic on Home and Claude writes 3 questions on it, rising in difficulty. Questions store the taxonomy `topic_id`; an unknown topic is rejected with HTTP 400. |
| **Instant grading** | Each question's answer key is stored server-side when it is written. Submitting is graded against that key in milliseconds, with no Claude call. The same request saves the response, updates topic mastery and logs a learning event. |
| **Topic lessons** | Theory, a guided worked example and pitfalls. Cached per topic in the database, so a lesson is written once for everyone. The transfer exercise has an answer box that Claude grades inline (saved, shown again on re-open, no rating change). Each lecture section has an **Ask about this** box (plus a general **Ask a question** box): Claude answers for a confused reader, saves the Q&A and notes the knowledge gap; **Update lesson with my questions** then rewrites the affected sections into a cached *Adapted to your questions* version (toggle with Show original / Show adapted; Regenerate drops it and re-opens the gaps, the Q&A history is kept). Lesson variants: Make it shorter, Show another example, Review prerequisites. A practice exercise with staged hints is prepared in the background. |
| **Practice workspace** | Editor, notes and staged hints for the exercise. Running code in a sandbox is not connected yet. |
| **Progress** | Attempts, assessment responses and mastery are saved per account in PostgreSQL. Assessment responses and mastery are written by `/api/assessment/grade`, not by the client. |

The answer key never reaches the browser before you submit: `/api/assessment_items` strips it,
and clients cannot overwrite it.

## Requirements

- Node.js 20
- PostgreSQL 14+ (tested with 16)
- [Claude CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in on the machine that runs the app:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude auth status        # should report loggedIn: true
  ```
  The CLI must be on the `PATH` of the Next.js process. The model defaults to `claude-sonnet-5-5` and is configurable
  (profile page, or env `CLAUDE_MODEL`); see "AI provider setting" below.
- Optional: [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) as an
  alternative provider (`npm install -g @github/copilot`, then `copilot login` or set `COPILOT_GITHUB_TOKEN`).
  See "AI provider setting" below.

## Setup

1. Create a database and a user (example for local development):
   ```bash
   sudo -u postgres psql -c "CREATE USER embedpath WITH PASSWORD 'embedpath' CREATEDB;" \
                         -c "CREATE DATABASE embedpath OWNER embedpath;"
   ```
2. Create `.env.local` (it is git-ignored):
   ```env
   DATABASE_URL=postgresql://embedpath:embedpath@localhost:5432/embedpath
   DATABASE_PROVIDER=postgres
   APP_JWT_SECRET=<a long random string, e.g. output of: openssl rand -hex 32>
   # optional: ALLOW_REGISTRATION=true   (registration is closed once the first account exists)
   ```
3. Install and migrate:
   ```bash
   npm install
   npm run db:migrate        # applies ./drizzle
   ```
4. Start the dev server and open http://localhost:3333:
   ```bash
   npm run dev
   ```
   Register an account on the first screen. Only the first account can register unless
   `ALLOW_REGISTRATION=true` is set.

   On WSL, keep the project on the Linux filesystem (for example `~/`) or start the server with
   `WATCHPACK_POLLING=true npm run dev`. Under `/mnt/c`, `/mnt/e` and similar drives Next.js does not
   notice file changes, so the browser keeps serving stale code until the server is restarted.

After editing `lib/db/schema.ts`, run `npm run db:generate` then `npm run db:migrate`.
Do not edit the generated SQL in `drizzle/` by hand.

## How the AI calls work

All AI calls go through `runClaudeJson` (`lib/ai-cli.ts`, re-exported from `lib/claude-cli.ts`), which picks the
active provider per call (see "AI provider setting"). The Claude provider spawns `claude --print` with
`--tools ''` (no tools, no file access) and `--json-schema`, so the output is validated before
the app sees it. Errors are reduced to a safe message; stderr stays in the server log. At most
4 Claude processes run at once and each learner may start 30 per minute; extra requests get HTTP 429.
Every spawn logs `[claude-cli] provider=<claude|copilot> purpose=<route/step> duration_ms=<n> result=<exit code | timeout | error>`.
Lecture, variant and adapt calls may take up to 240 s (a full lecture takes about 110 s); other calls 120 s.

### AI provider setting

Profile page, "AI provider": Claude CLI or Copilot CLI, with install/auth status, a "Test connection" button
and an optional failover checkbox. The choice is saved in `learner_profiles.preferences.ai_provider`
(`ai_failover` for the checkbox) through `GET/PUT/POST /api/settings/ai`; the server re-reads it on every AI
call (cached 5 s). Without a saved choice, env `AI_CLI_PROVIDER` (`claude` | `copilot`, default `claude`) applies.
`topic_lessons.model` records which model wrote a lesson (`claude-sonnet-5-5`, or `copilot:<model|auto>`; the label format is unchanged).

Model: one "Model" dropdown (Default, the provider's models, "Other…" for a free-text id) under the segmented control, used for every call of the selected provider (lesson, ask,
transfer, assessment generate and judge, enrich, Test connection). Ids differ per CLI, so the value is stored per provider as
`learner_profiles.preferences.ai_model = { claude: string|null, copilot: string|null }` and the input shows the value of the
selected provider (a stored id missing from the list preselects "Other…"; "Default" clears it). The lists come from `lib/ai-models.ts` and are returned by `GET` as `models.<provider> = { options, source, updated_at }`. Copilot: read live from `copilot help config` (the quoted values under the `model` setting; 3s timeout, cached 10 min, `GET ?refresh=1` / "Refresh list" bypasses the cache, built-in copy as fallback; if a Copilot update changes that output format, fix `parseCopilotModels`, the fallback keeps Settings working meanwhile). Claude: the CLI has no list command, so the list is the aliases `fable`/`opus`/`sonnet`/`haiku` (the CLI resolves each to the newest model, so they never go stale) plus concrete ids; when `ANTHROPIC_API_KEY` is set the ids come live from `GET /v1/models` (server side, cached 1h), otherwise from a small built-in list. The concrete model that answered (`modelUsage` of the CLI result) is what `topic_lessons.model` records. Precedence per provider: profile > env (`CLAUDE_MODEL` /
`COPILOT_MODEL`) > built-in default (claude: `claude-sonnet-5-5`; copilot: no `--model`, the CLI's own default). An id the account/plan does not allow fails with the CLI's error (shown by Test connection). Ids verified
here: claude `claude-haiku-5-5`; copilot `claude-haiku-5.5` and `auto`. `PUT /api/settings/ai {"models":{"claude":"claude-haiku-5-5"}}`
(or `{"model":"..."}` for the active provider; `null`/`""` resets); an id must match `/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/`
(no spaces, cannot start with `-`), else 400. `GET` returns `provider`, `failover`, `availability`, `model` (stored) and
`effective` (id + source `profile|env|default` + label). On failover the other provider uses its own stored model or default.
A change only affects NEW generations; cached lessons keep their label until Regenerate.

| Env var | Meaning |
|---|---|
| `AI_CLI_PROVIDER` | Default provider when the profile has no choice yet |
| `CLAUDE_MODEL` | Optional Claude model id/alias used when the profile sets none (default `claude-sonnet-5-5`). Invalid values are ignored |
| `COPILOT_MODEL` | Optional `--model` for Copilot when the profile sets none (e.g. `claude-sonnet-5.5`, `claude-haiku-5.5`, `gpt-5.4-mini`, `auto`). Unset = Copilot's own default (it used `claude-sonnet-5.5` on the test host) |
| `COPILOT_HOME_DIR` | Optional: passed to Copilot as `COPILOT_HOME` (its state/login dir, default `~/.copilot`) |
| `COPILOT_GITHUB_TOKEN` | Optional Copilot auth instead of `copilot login` (`GH_TOKEN`/`GITHUB_TOKEN` also work). Never returned by the API |
| `COPILOT_BIN` | Optional path of the copilot binary (tests) |

How Copilot is called: `copilot -p <system text + request + schema> --output-format json --available-tools=none
--disable-builtin-mcps --no-custom-instructions --no-ask-user --allow-all-tools --no-auto-update [--model X]`,
in an empty temp directory, in its own process group (killed as a group on timeout). Caveats:

- Copilot has no `--json-schema` and no system-prompt flag, so the schema is part of the prompt and the answer is
  checked by a small validator (`lib/json-schema-lite.ts`). An invalid answer is retried once with the problems
  listed, then fails with 502. Expect more retries/failures than with Claude's enforced schema.
- Tools are disabled (see HANDOFF for how that was verified); requests must be self-contained.
- Quota/rate-limit/auth errors map to 429/503 messages. With failover on, such an error (or a missing binary)
  retries once on the other provider; nothing is persisted, and other errors never fail over.
- Terms of use: this uses your personal GitHub Copilot entitlement. Keep it to personal single-user use of this app.
- A whole request must fit in one command-line argument (about 120 KB).

| Route | Purpose |
|---|---|
| `GET/PUT/POST /api/settings/ai` | Provider setting + availability; `POST` runs a tiny test call through a provider |
| `POST /api/assessment/generate` | No body: starts a diagnostic (plans one slot per domain, returns question 1). `{ session_id, slot }`: writes another slot. `{ domain_id, topic_id, topic_label }`: starts a 3-question topic assessment. |
| `POST /api/assessment/grade` | `{ item_id, selected_answers, ... }`. Grades one item against its stored answer key and returns a full review. In one transaction it also saves the `assessment_responses` row, updates `topic_mastery` (score moves toward the evidence, at most ±8 per submit; level band moves at most one step; confidence is capped) and adds a `learning_events` row. Idempotent per item (advisory lock): a repeat submit returns the saved result with `replayed: true` and applies mastery only once. |
| `GET /api/assessment/history?limit&cursor` | Assessment history of the signed-in learner, newest first: `{session_id, mode, selection ('topic'/'custom'/'diagnostic'/'retake'), topics, title, status, started_at, completed_at, question_count, answered_count, correct_count, score_pct, mastery_changes}`; `next_cursor` for the next page. Aggregates only. Abandoned sessions show only if something was answered; seed placeholders never. `selection` comes from `timing_policy.selection`, else is inferred from the plan (1 topic = topic, one topic per domain = diagnostic). |
| `GET /api/assessment/session?id=` | Review data of one session. Answered items carry your answer, the correct answer, outcome, explanation, misconception, difficulty rationale; unanswered items carry stem/options only (never the key). Another learner's id is a 404. |
| `POST /api/assessment/generate { retake_session_id }` | "Retry the same questions": copies the items into a new `review_retake` session (new ids, options reshuffled, no AI call). Graded as usual but mastery is NOT touched (zero deltas, `assessment_review` event instead of `assessment`). "Retake this topic" is the normal `{topics, question_count, mode}` call (new questions). |
| `POST /api/assessment/cleanup` | Marks the account's `in_progress` sessions older than 24 hours that have no graded response as `abandoned`. Nothing is deleted; stale sessions that already have a response are left alone. `grade` sets a session to `completed` once every planned question has a response. The app calls it on load. |
| `POST /api/lesson` | `{ domain_id, topic_id, part: "lecture" \| "practice", action?, regenerate? }`. Cached in `topic_lessons`. `action` is `shorter`, `another-example`, `prerequisites` or `adapt` (rewrites the lecture for the learner's open gaps, latest 8, cached as `lecture:adapted`; unknown actions return 400). |
| `POST /api/lesson/ask` | `{ domain_id, topic_id, section_index \| null, question, variant? }`. Claude answers a question about one cached lecture section (text read server-side; question max 1500 characters) and notes whether it reveals a knowledge gap. Saved as a `learning_events` row of type `question` (no migration). `GET` with the ids returns the saved Q&A, the open-gap count and whether an adapted lecture exists. |
| `POST /api/lesson/transfer` | `{ domain_id, topic_id, answer, variant? }`. Claude grades the answer to the cached lesson's transfer exercise (max 4000 characters) and saves an `attempts` row plus a `transfer` learning event; `topic_mastery` is not changed. `GET` with the same ids returns the latest saved answer and feedback. |
| `POST /api/claude` | General coach call (practice submission and the legacy review actions). Takes `{ message }` only; it never receives an assessment answer key. |
| `/api/<table>` | CRUD for `learner_profiles`, `topic_mastery`, `activities`, `attempts`, `recommendations`, `assessment_sessions`, `assessment_items`, `assessment_responses`, `learning_events`, `study_sessions`. Owner-scoped via `scopedRepo`. |
| `/api/auth/*` | Register, login, logout, current user. |

**Concurrency and retries.** `lib/single-flight.ts` makes concurrent identical lesson and question
generations share one Claude call (in-process, so it assumes a single app instance). Inserting a
question slot also takes a Postgres advisory lock, so a racing request reuses the item that won instead of adding a second one.
Asking for a slot that already has an item returns HTTP 409.
In the browser, background question generation uses `lib/retry.ts`: up to 3 attempts with backoff
(1s, 3s; longer, 5s and 10s, when the server is busy with 429); a 409 means the slot already exists and its item is used.
Slots that still fail show a banner with a Retry button, and questions are always shown in slot order.

Schemas for the coach result live in `lib/coach-schema.ts`. They mirror what
`normalizeCoachResult()` in `lib/normalize.ts` requires, so Claude can only return a shape the UI can render.

## Project layout

```
app/page.tsx            single-page app shell (views: home, practice, assessment, review, lesson, skill map, history, profile)
app/sections/           page-level sections and app shell
hooks/                  use-saved-data (saved data), use-lesson (lesson, retrieval, transfer)
lib/normalize.ts        value coercers and normalizeCoachResult
lib/app-types.ts        shared page types; sample-data, assessment-slots, assessment-view and home-recommendation hold pure helpers
app/api/                route handlers
lib/ai-cli.ts           AI runner: Claude CLI + Copilot CLI providers, failover (lib/claude-cli.ts re-exports it)
lib/ai-settings.ts      active provider (profile preference / env), CLI availability
lib/json-schema-lite.ts schema subset validator for Copilot output
lib/coach-schema.ts     JSON schemas for coach output
lib/taxonomy.ts         single source of truth: 6 domains, 83 topics in learning order (with prerequisites), 4 sub-topics each
lib/assessment-topics.ts  view over the taxonomy: sub-topic pool and helpers for planning a diagnostic
lib/learning-topics.ts  view over the taxonomy: topic picker options (shared by UI and /api/lesson)
lib/single-flight.ts    de-duplicates concurrent identical server calls
lib/retry.ts            client retry policy for background question generation
scripts/                cleanup-topic-mastery.sql (generated) and its generator
lib/db/schema.ts        Drizzle schema
drizzle/                generated migrations
```

Open work and how to continue on another machine: see [HANDOFF.md](HANDOFF.md).

## Taxonomy maintenance

Lessons, assessments and `topic_mastery` all key off the ids in `lib/taxonomy.ts`, so renaming an id
orphans its data. To remove `topic_mastery` rows whose topic is not in the taxonomy, run
`scripts/cleanup-topic-mastery.sql` by hand (it is never run automatically): run its preview `SELECT`
first, then the `DELETE`, e.g. `psql "$DATABASE_URL" -f scripts/cleanup-topic-mastery.sql`.
The file is generated; after editing the taxonomy, regenerate it with:
```bash
npx tsx scripts/gen-cleanup-topic-mastery.ts
```

## Known limitations

- **Copilot provider is prompt-constrained.** See "AI provider setting". Request-size limit ~120 KB.
- **Local use only.** The Docker image and Netlify config do not contain the `claude` binary or a
  Claude login, so every AI request would fail there. Run the app on a machine where Claude CLI works.
- **Cost and abuse.** Every AI request uses the host's Claude account. Registration closes after the
  first account (set `ALLOW_REGISTRATION=true` to reopen it), each learner may start at most 30 Claude
  calls per minute, and at most 4 run at once. The limiter lives in process memory, so it is not shared
  across several server instances.
- **Cached lessons are generic.** A cached lesson is not adapted to the learner's level.
  Delete its row in `topic_lessons` to have Claude rewrite it.
- **Assessment progress.** "Save & next" advances without saving that answer; each question is
  graded when you press Submit.
- **Cached lessons keep the prompt they were written with.** Lessons cached before the transfer-exercise
  rules changed may have a code-less or compile-and-run transfer exercise; press Regenerate on the lesson.
- **Hardcoded UI numbers.** The header's "6 day streak" and "12 exercises" are placeholders.
- **Lint.** `npm run lint` uses `next lint`, which Next 16 removed; run `npx eslint .` instead.
