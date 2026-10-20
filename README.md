# EmbedPath

An adaptive, practice-first tutor for embedded-systems engineers. It covers five domains
(C, C++, Linux, Networking, BSP) and tracks a separate mastery level per domain and topic.

Everything the AI writes (assessment questions, lessons, practice exercises, coaching feedback)
is produced by **Claude CLI running on the host machine**, using that machine's existing
Claude login. The app never asks for or stores an Anthropic API key.

## What it does

| Feature | How it works |
|---|---|
| **Mixed diagnostic** | Claude writes 5 fresh multiple-choice questions (one per domain) with random sub-topics, difficulty and angle. Question 1 appears first; the rest are written in the background. |
| **Topic assessment** | Pick one topic on Home and Claude writes 3 questions on it, rising in difficulty. |
| **Instant grading** | Each question's answer key is stored server-side when it is written. Submitting is graded against that key in milliseconds, with no Claude call. |
| **Topic lessons** | Theory, a guided worked example and pitfalls. Cached per topic in the database, so a lesson is written once for everyone. A practice exercise with staged hints is prepared in the background. |
| **Practice workspace** | Editor, notes and staged hints for the exercise. Running code in a sandbox is not connected yet. |
| **Progress** | Attempts, assessment responses and mastery are saved per account in PostgreSQL. |

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
| `POST /api/assessment/grade` | Grades one item against its stored answer key and returns a full review. |
| `POST /api/lesson` | `{ domain_id, topic_id, part: "lecture" \| "practice" }`. Cached in `topic_lessons`. |
| `POST /api/claude` | General coach call (lecture actions, retrieval checks, free-form coach requests). |
| `/api/<table>` | CRUD for `learner_profiles`, `topic_mastery`, `activities`, `attempts`, `recommendations`, `assessment_sessions`, `assessment_items`, `assessment_responses`, `learning_events`, `study_sessions`. Owner-scoped via `scopedRepo`. |
| `/api/auth/*` | Register, login, logout, current user. |

Schemas for the coach result live in `lib/coach-schema.ts`. They mirror what
`normalizeCoachResult()` in `app/page.tsx` requires, so Claude can only return a shape the UI can render.

## Project layout

```
app/page.tsx            single-page app (views: home, practice, assessment, review, skill map, history, profile)
app/sections/           page-level sections
app/api/                route handlers
lib/claude-cli.ts       Claude CLI runner
lib/coach-schema.ts     JSON schemas for coach output
lib/assessment-topics.ts  sub-topic pool the server draws from when planning a diagnostic
lib/learning-topics.ts  topic picker options (shared by UI and /api/lesson)
lib/db/schema.ts        Drizzle schema
drizzle/                generated migrations
```

## Known limitations

- **Local use only.** The Docker image and Netlify config do not contain the `claude` binary or a
  Claude login, so every AI request would fail there. Run the app on a machine where Claude CLI works.
- **Cost and abuse.** Registration is open and every AI request uses the host's Claude account.
  The only guard is the 4-process cap. Add per-user rate limits or disable public registration
  before exposing the app to others.
- **Leftover Lyzr routes.** `/api/agent`, `/api/upload`, `/api/rag`, `/api/scheduler` and `/api/voice/session`
  come from the original template, are no longer used by the UI, and are **not authenticated**.
  They only work if `LYZR_API_KEY` is set; leave it unset or delete the routes.
- **Cached lessons are generic.** A cached lesson is not adapted to the learner's level.
  Delete its row in `topic_lessons` to have Claude rewrite it.
- **Assessment progress.** "Save & next" advances without saving that answer; each question is
  graded when you press Submit.
- **Hardcoded UI numbers.** The header's "6 day streak" and "12 exercises" are placeholders.
- **Type checking is off in builds** (`ignoreBuildErrors: true`). Run `npx tsc --noEmit` yourself.
  `npm run lint` uses `next lint`, which Next 16 removed; run `npx eslint .` instead.
