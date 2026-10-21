# EmbedPath

An adaptive, practice-first tutor for embedded-systems engineers. It covers five domains
(C, C++, Linux, Networking, BSP) and tracks a separate mastery level per domain and topic.

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
  The CLI must be on the `PATH` of the Next.js process. The app pins it to `claude-sonnet-5-5`
  (`MODEL` in `lib/claude-cli.ts`).

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
   Register an account on the first screen.

After editing `lib/db/schema.ts`, run `npm run db:generate` then `npm run db:migrate`.
Do not edit the generated SQL in `drizzle/` by hand.

## How the AI calls work

All Claude calls go through `lib/claude-cli.ts`, which spawns `claude --print` with
`--tools ''` (no tools, no file access) and `--json-schema`, so the output is validated before
the app sees it. Errors are reduced to a safe message; stderr stays in the server log. At most
4 Claude processes run at once; extra requests get HTTP 429.

| Route | Purpose |
|---|---|
| `POST /api/assessment/generate` | No body: starts a diagnostic (plans 5 slots, returns question 1). `{ session_id, slot }`: writes another slot. `{ domain_id, topic_id, topic_label }`: starts a 3-question topic assessment. |
| `POST /api/assessment/grade` | `{ item_id, selected_answers, ... }`. Grades one item against its stored answer key and returns a full review. In one transaction it also saves the `assessment_responses` row, updates `topic_mastery` (score moves toward the evidence, at most ±8 per submit; level band moves at most one step; confidence is capped) and adds a `learning_events` row. Idempotent per item (advisory lock): a repeat submit returns the saved result with `replayed: true` and applies mastery only once. |
| `POST /api/assessment/cleanup` | Marks the account's `in_progress` sessions older than 24 hours that have no graded response as `abandoned`. Nothing is deleted; stale sessions that already have a response are left alone. `grade` sets a session to `completed` once every planned question has a response. The app calls it on load. |
| `POST /api/lesson` | `{ domain_id, topic_id, part: "lecture" \| "practice", action?, regenerate? }`. Cached in `topic_lessons`. `action` is `shorter`, `another-example`, `prerequisites` or `adapt` (rewrites the lecture for the learner's open gaps, latest 8, cached as `lecture:adapted`; unknown actions return 400). |
| `POST /api/lesson/ask` | `{ domain_id, topic_id, section_index \| null, question, variant? }`. Claude answers a question about one cached lecture section (text read server-side; question max 1500 characters) and notes whether it reveals a knowledge gap. Saved as a `learning_events` row of type `question` (no migration). `GET` with the ids returns the saved Q&A, the open-gap count and whether an adapted lecture exists. |
| `POST /api/lesson/transfer` | `{ domain_id, topic_id, answer, variant? }`. Claude grades the answer to the cached lesson's transfer exercise (max 4000 characters) and saves an `attempts` row plus a `transfer` learning event; `topic_mastery` is not changed. `GET` with the same ids returns the latest saved answer and feedback. |
| `POST /api/claude` | General coach call (lecture actions, retrieval checks, free-form coach requests). |
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
lib/claude-cli.ts       Claude CLI runner
lib/coach-schema.ts     JSON schemas for coach output
lib/taxonomy.ts         single source of truth: 5 domains, 51 topics in learning order (with prerequisites), 4 sub-topics each
lib/assessment-topics.ts  view over the taxonomy: sub-topic pool and helpers for planning a diagnostic
lib/learning-topics.ts  view over the taxonomy: topic picker options (shared by UI and /api/lesson)
lib/single-flight.ts    de-duplicates concurrent identical server calls
lib/retry.ts            client retry policy for background question generation
scripts/                cleanup-topic-mastery.sql (generated) and its generator
lib/db/schema.ts        Drizzle schema
drizzle/                generated migrations
```

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

- **Local use only.** The Docker image and Netlify config do not contain the `claude` binary or a
  Claude login, so every AI request would fail there. Run the app on a machine where Claude CLI works.
- **Cost and abuse.** Registration is open and every AI request uses the host's Claude account.
  The only guard is the 4-process cap. Add per-user rate limits or disable public registration
  before exposing the app to others.
- **Cached lessons are generic.** A cached lesson is not adapted to the learner's level.
  Delete its row in `topic_lessons` to have Claude rewrite it.
- **Assessment progress.** "Save & next" advances without saving that answer; each question is
  graded when you press Submit.
- **Hardcoded UI numbers.** The header's "6 day streak" and "12 exercises" are placeholders.
- **Lint.** `npm run lint` uses `next lint`, which Next 16 removed; run `npx eslint .` instead.
