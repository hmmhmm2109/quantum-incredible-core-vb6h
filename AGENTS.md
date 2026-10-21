# Next.js React Frontend

## START HERE

EmbedPath is a single-user embedded-systems learning app: Home, Skill Map, Lesson (with retrieval check, transfer exercise and Q&A), topic Practice, adaptive Assessment, Review and History. AI runs only through the local Claude CLI on the host (`lib/claude-cli.ts`); there is no Lyzr agent API.

Before changing a feature, read `README.md` and the files that feature owns (see "UI Code Location"). Topics, domains and their ids come from `lib/taxonomy.ts` only. `response_schemas/` and `workflow.json` are leftovers of the original build; the coach result shape is `lib/coach-schema.ts` plus `normalizeCoachResult()` in `lib/normalize.ts`.

---

## Import Rules

**Icons:** `lucide-react` ONLY — `react-icons` (all sub-packages) and `@radix-ui/react-icons` are BANNED and cause build failures. Replace any react-icons usage with lucide-react equivalents.
```tsx
import { Loader2, Send, X } from 'lucide-react'
```

**Components:** `@/components/ui/*` (shadcn only)
```tsx
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
```

**AI calls** — server routes only. Route handlers call `runClaudeJson` from `@/lib/claude-cli` (Claude CLI, JSON-schema output, max 4 concurrent processes; throws `ClaudeCliError` with an HTTP status). Wrap work that several requests may start at once in `singleFlight` (`@/lib/single-flight`). The browser never calls Claude directly: it calls the routes below with `authFetch` from `useAuth()` (`lyzr-architect-pg/client`), and wraps calls worth repeating in `withRetry` (`@/lib/retry`).
```ts
import { ClaudeCliError, runClaudeJson } from '@/lib/claude-cli'
const raw = await runClaudeJson({ systemPrompt, message, jsonSchema }) // inside an authMiddleware route
```

---

## COMPONENT WHITELIST (CLOSED SET — nothing else exists)

**ONLY these components may be used in the UI.** If a name is not listed here, it does NOT exist. Define custom components as functions inside the page or section file that uses them.

> **Design-system exception:** If the file `components/.design-system-manifest.md` exists, the active design system has pre-installed extra components. Every component listed in that manifest ALSO exists and MAY be imported and used (import by the path it gives; open the file to confirm exact exports before use). This is the ONLY exception to the closed set — do not treat any other unlisted name as real, and do not recreate or duplicate the manifest's components inline. (Design systems may also silently restyle the shadcn primitives below; use them exactly as normal — the restyling is automatic.)

> **Brand guidelines (`DESIGN.md`):** If a `DESIGN.md` file exists at the project root, the active design system ships its brand guidelines there — voice/tone, color-usage rules, typography, shape/elevation, layout, and component conventions. **Read `DESIGN.md` before building and follow it for every visual and copy decision**; it overrides generic defaults. It is guidance only (not a component source): design tokens still come from `globals.css` and extra components from the manifest above.

### shadcn/ui Components (import from `@/components/ui/<file>`)

| File | Exports |
|------|---------|
| accordion | `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` |
| alert | `Alert`, `AlertTitle`, `AlertDescription` |
| alert-dialog | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` |
| aspect-ratio | `AspectRatio` |
| avatar | `Avatar`, `AvatarImage`, `AvatarFallback` |
| badge | `Badge` |
| breadcrumb | `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator` |
| button | `Button` |
| calendar | `Calendar` |
| card | `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`, `CardContent` |
| carousel | `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext` |
| chart | `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent` |
| checkbox | `Checkbox` |
| collapsible | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` |
| command | `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandSeparator` |
| context-menu | `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuLabel`, `ContextMenuSeparator` |
| dialog | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose` |
| drawer | `Drawer`, `DrawerTrigger`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription`, `DrawerClose` |
| dropdown-menu | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuGroup` |
| empty | `Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`, `EmptyMedia` |
| form | `Form`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `FormField` |
| hover-card | `HoverCard`, `HoverCardTrigger`, `HoverCardContent` |
| input | `Input` |
| input-group | `InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupText` |
| input-otp | `InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator` |
| label | `Label` |
| menubar | `Menubar`, `MenubarMenu`, `MenubarTrigger`, `MenubarContent`, `MenubarItem`, `MenubarSeparator` |
| navigation-menu | `NavigationMenu`, `NavigationMenuList`, `NavigationMenuItem`, `NavigationMenuContent`, `NavigationMenuTrigger`, `NavigationMenuLink` |
| pagination | `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationNext`, `PaginationPrevious` |
| popover | `Popover`, `PopoverTrigger`, `PopoverContent` |
| progress | `Progress` |
| radio-group | `RadioGroup`, `RadioGroupItem` |
| resizable | `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` |
| scroll-area | `ScrollArea`, `ScrollBar` |
| select | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`, `SelectGroup`, `SelectLabel` |
| separator | `Separator` |
| sheet | `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetClose` |
| sidebar | `Sidebar`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupContent`, `SidebarGroupLabel`, `SidebarHeader`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuItem`, `SidebarProvider`, `SidebarTrigger` |
| skeleton | `Skeleton` |
| slider | `Slider` |
| sonner | `Toaster` |
| spinner | `Spinner` |
| switch | `Switch` |
| table | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` |
| tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| textarea | `Textarea` |
| toggle | `Toggle` |
| toggle-group | `ToggleGroup`, `ToggleGroupItem` |
| tooltip | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` |

### lucide-react Icons (commonly used)

```
Search, Send, X, Plus, Minus, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Loader2, Menu, Settings, User, Users,
Home, Mail, Phone, Calendar, Clock, Star, Heart, Trash2, Edit, Copy, Download,
Upload, File, FileText, Image, Camera, Mic, MicOff, Volume2, VolumeX, Play, Pause,
Square, Circle, AlertCircle, AlertTriangle, Info, HelpCircle, ExternalLink, Link,
Eye, EyeOff, Lock, Unlock, Shield, Zap, RefreshCw, RotateCcw, Filter, SortAsc,
MapPin, Globe, Bookmark, Tag, Hash, AtSign, MessageSquare, MessageCircle, Bot,
Sparkles, Wand2, Palette, Layout, Grid, List, BarChart3, PieChart, TrendingUp
```

Any lucide-react icon name is valid — check https://lucide.dev/icons for the full set. The list above is for convenience.

### HALLUCINATION BLACKLIST (these DO NOT exist — never use them)

| Hallucinated Name | Use Instead |
|---|---|
| `SectionCard` | `Card` + `CardHeader` + `CardContent` |
| `DiscoverScreen` | Plain `<div>` or `Card` |
| `FeatureCard` | `Card` + `CardContent` — or define inline: `function FeatureCard(...)` |
| `ActionButton` | `Button` |
| `IconButton` | `Button` with `variant="ghost" size="icon"` |
| `TextInput` | `Input` |
| `SearchInput` | `Input` with a Search icon |
| `NavBar` / `Navbar` | `<nav>` with Tailwind — or define inline |
| `Container` | `<div className="max-w-7xl mx-auto px-4">` |
| `Hero` / `HeroSection` | Plain `<section>` with Tailwind |
| `Footer` | `<footer>` with Tailwind |
| `Modal` | `Dialog` |
| `Dropdown` | `DropdownMenu` or `Select` |
| `Toast` | `Toaster` from sonner |
| `Chip` | `Badge` |
| `Tag` | `Badge` |
| `Spinner` (from wrong path) | `Spinner` from `@/components/ui/spinner` or `Loader2` with `animate-spin` |
| `Box` / `Stack` / `Flex` | Plain `<div>` with Tailwind flex/grid classes |

**Rule:** If you need a component that isn't in the whitelist above, **define it as a function** in the file that uses it:

```tsx
// CORRECT — define custom components in the file that uses them
function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent><p>{desc}</p></CardContent>
    </Card>
  )
}
```

---

## API Response Contracts

Data routes (`/api/<table>`) return `{ success: true, data }` or `{ success: false, error }` with a 4xx/5xx status. The AI routes return the same envelope; coach-shaped results arrive as:

| Field | Type | Meaning |
|---|---|---|
| `success` | `boolean` | Did the request succeed? |
| `response.status` | `'success' \| 'error'` | Did the coach itself succeed? |
| `response.result` | object | The coach result (`lib/coach-schema.ts` shape), passed through `normalizeCoachResult()` (`lib/normalize.ts`) before rendering |
| `response.metadata` | object | Agent name, timestamp, request id |

1. Read the shape from `lib/coach-schema.ts` and the route's header comment, not from guesses.
2. A response that fails `normalizeCoachResult()` is an error state ("did not match the saved learning schema"); do not paper over it with fallback fields.
3. **NEVER use static fallback strings like `'Analysis complete.'`** — show an error state when the response is empty.
4. The cached lecture keeps `retrieval_check.answer_rule` in `topic_lessons` for grading; `POST /api/lesson` blanks it before the response so the learner never sees the answer before submitting. Never send it to the client.

---

## CRITICAL: EXISTING CODE — REUSE, NEVER RECREATE

Reuse what exists. Do not duplicate a route, helper or provider; extend it. New `route.ts` files are only for new tables or flows (see Database & Auth).

### API Routes (`app/api/**/route.ts`, all behind `authMiddleware` except where noted)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/login`, `/register`, `/logout`, `/me` | POST/POST/POST/GET | Pre-built `lyzr-architect-pg` auth handlers (no `authMiddleware`) |
| `/api/seed` | POST | Idempotent per-user seed (profile, starter activity, recommendation); single-flight + advisory lock |
| `/api/learner_profiles`, `/topic_mastery`, `/activities`, `/attempts`, `/recommendations`, `/study_sessions`, `/learning_events` | GET/POST/PATCH/DELETE | Owner-scoped CRUD over the matching table |
| `/api/assessment_sessions`, `/assessment_items`, `/assessment_responses` | GET/POST/PATCH/DELETE | Owner-scoped CRUD; PATCH `assessment_sessions` `{ id, status: 'abandoned' }` discards a session |
| `/api/assessment/generate` | POST | Create a session (one topic or mixed diagnostic) or write one slot `{ session_id, slot }` with Claude; 409 when the slot exists |
| `/api/assessment/grade` | POST | Grade one item on the server against the stored key (0 Claude calls), idempotent per item, updates mastery |
| `/api/assessment/cleanup` | POST | Mark stale (24h, no response) `in_progress` sessions `abandoned` |
| `/api/lesson` | POST | Lecture (base, variants, `adapt`, `cached_only`, `regenerate`) or topic practice (`next`) from the `topic_lessons` cache; Claude only on a miss |
| `/api/lesson/ask` | GET/POST | Per-topic learner Q&A stored as `question` learning events (gaps feed `adapt`) |
| `/api/lesson/transfer` | GET/POST | Claude grades a transfer exercise, or a retrieval check with `kind: 'retrieval'`; saved as an attempt + learning event |
| `/api/lesson/complete` | POST | "Mark as learned" |
| `/api/claude` | POST | Generic coach request (practice answers, lecture actions); also serves graded results shaped like the coach schema |
| `/api/health`, `/api/sso-config`, `/api/access-check` | GET | Health check and SSO plumbing (do not modify `sso-config`) |

### Libraries and hooks

| Module | Use for |
|--------|---------|
| `@/lib/taxonomy` | Single source of truth for domains, topics (learning order, prerequisites, subtopics). Renaming an id orphans stored data. Views over it: `@/lib/learning-topics` (picker options), `@/lib/assessment-topics` (sub-topic pool) |
| `@/lib/claude-cli` | `runClaudeJson`, `ClaudeCliError`, `MODEL` (server only) |
| `@/lib/coach-schema` | JSON schema of the coach result passed to Claude |
| `@/lib/single-flight` | `singleFlight(key, run)`: concurrent identical server calls share one execution |
| `@/lib/retry` | `withRetry`, `HttpError`: client retry policy (3 attempts, backoff, longer on 429) |
| `@/lib/lesson-gaps` | Learner-question events (`question`) and open-gap helpers |
| `@/lib/normalize` | Value coercers and `normalizeCoachResult` / `normalizeActivity` / `normalizeQuestion` |
| `@/lib/app-types`, `@/lib/sample-data`, `@/lib/assessment-slots`, `@/lib/assessment-view`, `@/lib/home-recommendation` | Page types, sample data, slot ordering, and pure builders for Home / Skill Map / assessment view data |
| `@/hooks/use-saved-data` | Saved profile / mastery / attempts / assessments, `refreshMastery`, sample-data switch |
| `@/hooks/use-lesson` | Lesson, topic practice, retrieval check and transfer handlers |
| `@/lib/clipboard` | `copyToClipboard`, `useCopyToClipboard` |
| `@/lib/utils` | `cn` |

`scripts/gen-cleanup-topic-mastery.ts` regenerates `scripts/cleanup-topic-mastery.sql` from `lib/taxonomy.ts` (`npx tsx scripts/gen-cleanup-topic-mastery.ts`); rerun it whenever the taxonomy changes.

### Components (NEVER create files in `components/`)

`components/ui/*` is shadcn. `components/` also holds infrastructure (`ClientProviders`, `ErrorBoundary`, `IframeLoggerInit`, `SSOGuard`). Page-level UI lives in `app/sections/` (see below).

### Providers (already in `layout.tsx` — NEVER recreate)

`ErrorBoundary` (via `ClientProviders`) · `IframeLoggerInit` · `SSOGuard`

**If it exists, import it. Do not rebuild it.**

### Pre-configured infrastructure — DO NOT MODIFY

- `app/layout.tsx` — contains the `SSOGuard` auth gate and all providers. Never modify this file.
- `app/api/sso-config/` — SSO config proxy route. Never modify or delete this route.
- `components/SSOGuard.tsx` — Keycloak SSO guard. Never modify this file.

**NEVER modify `components/ClientProviders.tsx`** — it is infrastructure. Do not add `AuthProvider` or any other provider to it. `AuthProvider` belongs in `app/page.tsx` only (see Database & Auth section).

---

## UI Code Location

`app/page.tsx` is composition: `AuthProvider` + `ProtectedRoute`, view state, and the handlers that tie sections to hooks. Keep it from growing back into a monolith.

| Where | What |
|-------|------|
| `app/page.tsx` | View routing, assessment and practice flow state, `requestCoach` |
| `app/sections/*.tsx` | Page-level sections, typed props: `home-section`, `skill-map-section`, `lesson-section` (+ `lesson-ask`), `practice-section` (practice and assessment), `result-section`, `app-shell` (auth screen, navigation, header), `history-profile-section` |
| `hooks/use-saved-data.ts`, `hooks/use-lesson.ts` | Data loading and lesson handlers shared across views |
| `lib/*.ts` | Pure helpers, types and sample data (see the table above) |

Views: `home`, `practice`, `assessment`, `review`, `lesson`, `skill-map`, `history`, `profile`.

---

## Sections

- `app/sections/*.tsx` — page-level sections only; keep each focused on one view or one shell concern (currently 8 files)
- Each: `'use client'`, typed props. View sections have one `export default function`; `app-shell.tsx` and `history-profile-section.tsx` group small related components as named exports
- Same import rules as page.tsx (shadcn/ui, lucide-react, @/lib/*)
- `components/` still reserved for shadcn/ui — NEVER create files there
- Do not rename exports or props that `app/page.tsx` passes; change both sides together

## Write Tool Fallback

If the Write tool fails for any large file (for example `app/page.tsx` or `app/sections/*.tsx`):
1. Write a minimal version first (imports + one component)
2. Use Edit to append remaining components one at a time
3. Never retry the same failed Write — always switch to incremental Edit

---

## Environment Variables

**Server-side (set by the host or in `.env.local`):**
```
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://...
APP_JWT_SECRET=...
```

The `claude` CLI must be on the server's `PATH` with a logged-in session (see README, Known limitations). Never hardcode a secret, and never prefix one with `NEXT_PUBLIC_` — that ships it to the browser.

**Client-side access (if needed):**
```tsx
// Only NEXT_PUBLIC_ prefixed vars are exposed to client
const publicVar = process.env.NEXT_PUBLIC_SOME_VAR
```

---

## Bundler

Both dev and build are pinned to webpack:
```bash
npm run dev    # next dev --webpack -p 3333
npm run build  # next build --webpack
```

Next 16 defaults `dev` and `build` to Turbopack when no bundler flag is set, and
Turbopack's PostCSS worker is not yet stable against this project's Tailwind v3
plus `postcss.config.js` setup — it crashes mid-compile and takes the preview
with it. Dropping `--turbopack` is NOT enough to avoid it; you have to ask for
webpack by name. Keep both scripts on the same bundler so the preview predicts
the production build.

Don't pass `--turbopack` and `--webpack` together: Next exits 1 on conflicting
bundler flags.

---

## Next.js 16 Breaking Changes (CRITICAL)

### Dynamic Route Params are a Promise

In Next.js 16, `params` in dynamic route handlers (`[id]/route.ts`) and page components is a **Promise** — accessing it synchronously returns `undefined`.

**ALWAYS await params before reading any field:**

```ts
// app/api/todos/[id]/route.ts
import { authMiddleware } from 'lyzr-architect-pg'
import { NextResponse } from 'next/server'

export const PATCH = authMiddleware(async (req: Request, ctx: any) => {
  const { id } = await ctx.params  // ← MUST await, not ctx.params.id directly
  if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
  // ...
})

export const DELETE = authMiddleware(async (req: Request, ctx: any) => {
  const { id } = await ctx.params  // ← same here
  // ...
})
```

```tsx
// app/posts/[id]/page.tsx — server component
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params  // ← await in page components too
  // ...
}
```

**Anti-pattern (breaks in Next.js 16):**
```ts
// ❌ WRONG — ctx.params.id is undefined, ctx.params is still a Promise
const id = ctx?.params?.id
```

### `searchParams` is also a Promise

```tsx
// ❌ WRONG
export default function Page({ searchParams }) {
  const q = searchParams.q
}

// ✅ CORRECT
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
}
```

---

## Available shadcn/ui Components (All Prebuilt)

All these components are prebuilt in `@/components/ui/` — import directly, no installation needed:

```
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb,
button, button-group, calendar, card, carousel, chart, checkbox, collapsible,
command, context-menu, dialog, drawer, dropdown-menu, empty, field, form,
hover-card, input, input-group, input-otp, item, kbd, label, menubar,
navigation-menu, pagination, popover, progress, radio-group, resizable,
scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner,
spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip
```

---

## IFRAME-BLOCKED APIs (CRITICAL!)

This app runs in an iframe. These browser APIs are BLOCKED and will throw errors:

### Clipboard - USE UTILITY!
```tsx
// BANNED - Will throw NotAllowedError:
navigator.clipboard.writeText(text)  // BLOCKED!

// CORRECT - Use safe utility:
import { copyToClipboard } from '@/lib/clipboard'

const handleCopy = async () => {
  const success = await copyToClipboard(text)
  if (success) setCopied(true)
}
```

### Other Blocked APIs
- `navigator.geolocation` - blocked
- `navigator.share()` - blocked
- `window.open()` - may be blocked

---

## Database & Auth — `lyzr-architect-pg` Package (PostgreSQL + Drizzle)

**See the database skill for full provisioning flow, schema templates, migration workflow, auth routes, and anti-localStorage rules.**

When the app has a database (`DATABASE_URL` env var is set) and `DATABASE_PROVIDER=postgres` (the default for all new apps), use the **`lyzr-architect-pg`** package + **Drizzle** for ALL database operations. Both are pre-installed — do NOT install them manually.

> **Legacy apps:** if `DATABASE_PROVIDER=mongodb`, this is an older Mongo-backed app — skip this section and follow the LEGACY subsection at the end instead.

> **Auth is already wired.** Login, register, logout and me routes exist, and `AuthProvider` + `ProtectedRoute` wrap the app in `app/page.tsx`. Every learner table is owner-scoped. Tables: `learner_profiles`, `topic_mastery`, `activities`, `attempts`, `recommendations`, `study_sessions`, `learning_events`, `assessment_sessions`, `assessment_items`, `assessment_responses`, `topic_lessons` (shared lesson cache, no owner).

**CRITICAL RULES:**
- **NEVER use `localStorage` or `sessionStorage` for application data** (tasks, notes, records, user data). localStorage is ONLY for UI preferences (theme, sidebar). All persistent data MUST go through API routes backed by the database.
- NEVER add a second auth mechanism; use the existing handlers and `useAuth().authFetch`
- NEVER write custom JWT, bcrypt, session, or cookie auth code
- NEVER import `mongoose`, `mongodb`, `pg`, or `@prisma/*` — use `lyzr-architect-pg` + drizzle
- NEVER access the `_users` table directly — use the auth API handlers
- **After ANY edit to `lib/db/schema.ts`, run `npm run db:generate` then `npm run db:migrate`.** Tables do not exist until migrations run.
- NEVER edit the generated SQL files in `drizzle/` by hand

### 1. Schema — `lib/db/schema.ts` + migrations

All tables are defined in ONE file: `lib/db/schema.ts`. Import column builders from `lyzr-architect-pg/schema` (it re-exports all of drizzle's pg-core plus helpers).

```ts
// lib/db/schema.ts
export { users } from 'lyzr-architect-pg/schema'  // auth table — keep this line
import { pgTable, text, boolean, integer, jsonb, index, timestamps, ownerUserId, generateId } from 'lyzr-architect-pg/schema'

// App WITH auth: include owner_user_id + index (rows are scoped per user)
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  title: text('title').notNull(),
  status: text('status').notNull().default('pending'),   // 'pending' | 'done'
  priority: integer('priority').notNull().default(0),
  owner_user_id: ownerUserId(),
  ...timestamps,                                          // created_at, updated_at
}, (t) => [index('tasks_owner_idx').on(t.owner_user_id)])

// App WITHOUT auth: omit owner_user_id — data is shared app-wide
export const notes = pgTable('notes', {
  id: text('id').primaryKey().$defaultFn(() => generateId()),
  body: text('body').notNull(),
  ...timestamps,
})
```

Then apply it (the platform already injected `DATABASE_URL`):

```bash
npm run db:generate   # writes SQL migration into ./drizzle
npm run db:migrate    # applies it to the app database
```

### 2. Data Access

**App WITH auth → `scopedRepo`** (auto-scopes every query to the logged-in user):

```ts
import { scopedRepo } from 'lyzr-architect-pg'
import { tasks } from '@/lib/db/schema'

const repo = scopedRepo(tasks)
const rows = await repo.findMany({ orderBy: { created_at: 'desc' } })  // only this user's rows
const [row] = await repo.insert({ title: 'hello' })  // owner_user_id force-stamped
await repo.update(eq(tasks.id, id), { status: 'done' })  // no-op if not owned by user
await repo.delete(eq(tasks.id, id))                       // no-op if not owned by user
```

`scopedRepo` **throws if called outside `authMiddleware`** ("No auth context"). Cron/seed/system paths use `scopedRepo(tasks).system()` (unscoped — be deliberate).

**App WITHOUT auth → plain drizzle via `getDb()`:**

```ts
import { getDb } from 'lyzr-architect-pg'
import { notes } from '@/lib/db/schema'
import { eq, desc } from 'lyzr-architect-pg/schema'

const db = getDb()
const rows = await db.select().from(notes).orderBy(desc(notes.created_at))
await db.insert(notes).values({ body: 'hi' })
```

### 3. Auth Routes — Pre-built Handlers (already in `app/api/auth/*`)

**These routes exist; do not re-add them.** For reference:

```ts
// app/api/auth/register/route.ts
import { handleRegister } from 'lyzr-architect-pg'
export const POST = handleRegister  // Body: { email, password, name? }

// app/api/auth/login/route.ts
import { handleLogin } from 'lyzr-architect-pg'
export const POST = handleLogin  // Body: { email, password }

// app/api/auth/logout/route.ts
import { handleLogout } from 'lyzr-architect-pg'
export const POST = handleLogout

// app/api/auth/me/route.ts
import { handleMe } from 'lyzr-architect-pg'
export const dynamic = 'force-dynamic'
export const GET = handleMe  // Returns { user } or { user: null }
```

The `_users` table comes from the `export { users }` line in `lib/db/schema.ts` — it is created by your first migration. Never define your own users table.

### 4. API Routes

**Apps WITH auth: every route that touches user-owned tables MUST be wrapped in `authMiddleware` (401 when not logged in). `scopedRepo` throws without it.** Apps without auth: plain route handlers with `getDb()` are fine.

All API routes MUST use `try/catch` and return `{ success, data/error }` format.

```ts
import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { tasks } from '@/lib/db/schema'
import { eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const rows = await scopedRepo(tasks).findMany({ orderBy: { created_at: 'desc' } })
    return NextResponse.json({ success: true, data: rows })
  } catch (err: any) {
    console.error('[API] GET /api/tasks error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [row] = await scopedRepo(tasks).insert({ title: body.title })  // owner auto-stamped
    return NextResponse.json({ success: true, data: row }, { status: 201 })
  } catch (err: any) {
    console.error('[API] POST /api/tasks error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 400 })
  }
})
```

### 5. Client Components — Auth UI (already in `app/page.tsx` and `app/sections/app-shell.tsx`)

Do not add a second `AuthProvider`. `AuthProvider` MUST live in `app/page.tsx` — never in `layout.tsx`, `ClientProviders.tsx`, or any other file. Placing it outside `page.tsx` breaks React context across the RSC boundary and causes a permanent loading screen.

```tsx
// app/page.tsx  ← AuthProvider goes HERE, nowhere else
'use client'
import { AuthProvider, LoginForm, RegisterForm, UserMenu, ProtectedRoute } from 'lyzr-architect-pg/client'

// Auth screen with login/register toggle
function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true)
  return isLogin
    ? <LoginForm onSwitchToRegister={() => setIsLogin(false)} />
    : <RegisterForm onSwitchToLogin={() => setIsLogin(true)} />
}

// Wrap app in AuthProvider, use ProtectedRoute with unauthenticatedFallback
export default function Page() {
  return (
    <AuthProvider>
      <ProtectedRoute unauthenticatedFallback={<AuthScreen />}>
        <header><UserMenu /></header>
        <Dashboard />
      </ProtectedRoute>
    </AuthProvider>
  )
}

// Do NOT manually check `if (!user)` — ProtectedRoute handles it
// Do NOT use window.location.reload() — AuthProvider auto-updates state
// Do NOT put AuthProvider in ClientProviders.tsx or layout.tsx
```

### 6. How Owner Scoping Works

- `authMiddleware(handler)` extracts the JWT → sets the auth context with `userId`
- `scopedRepo(table)` ANDs `owner_user_id = userId` onto every find/update/delete/count
- On `insert`, `owner_user_id` is force-set to the logged-in user (spoofed values in the body are stripped)
- No context = `scopedRepo` throws (deny-by-default)
- The auth tables (`_users`) are refused by `scopedRepo` — use the auth handlers
- `.system()` is the deliberate escape hatch for cron/seed/admin paths

### 7. Env Vars (Auto-set, DO NOT hardcode)

```
DATABASE_PROVIDER=postgres        # Engine marker (set by platform)
DATABASE_URL=postgresql://...     # Per-app credential (set by platform)
APP_JWT_SECRET=...                # JWT signing secret (set by platform)
```

### LEGACY — apps with `DATABASE_PROVIDER=mongodb`

Older apps were built on a MongoDB stack (`lyzr-architect`/Mongoose) that the platform no longer supports. These apps keep **running**, but their database layer is **frozen**:
- Do NOT modify their models, DB queries, or auth wiring; do NOT swap in drizzle/lyzr-architect-pg (the platform cannot provision or manage Mongo databases anymore).
- Non-database changes (UI, styling, agent prompts) are fine.
- If the user asks for database changes on such an app, tell them the app must be rebuilt on the current PostgreSQL stack first.

---

## Anti-Hallucination Checklist

Before writing UI code:
- [ ] Read the feature's route header comment and `lib/coach-schema.ts` for exact field names?
- [ ] Topic and domain ids taken from `lib/taxonomy.ts`, never typed by hand?
- [ ] Using optional chaining (?.)?
- [ ] Loading/error states handled?
- [ ] Only lucide-react icons?
- [ ] Only shadcn/ui components?
- [ ] 'use client' directive for client components? (hooks, event handlers — all need it)
- [ ] Claude is only called from server routes (`runClaudeJson`), never from the browser?
- [ ] `retrieval_check.answer_rule` never sent to the client before grading?
- [ ] No navigator.clipboard? (use @/lib/clipboard)
- [ ] Database code uses `lyzr-architect-pg` + drizzle (never mongoose/pg/prisma; legacy mongo apps use `lyzr-architect`)?
- [ ] Auth uses pre-built handlers (not custom JWT/bcrypt)?
- [ ] Tables defined in `lib/db/schema.ts` and `npm run db:generate` + `npm run db:migrate` run after every schema edit?
- [ ] User-owned tables have `owner_user_id: ownerUserId()` + index, and are accessed via `scopedRepo` inside `authMiddleware`? (scopedRepo outside authMiddleware = "No auth context" crash)
- [ ] Dynamic route params awaited? (`const { id } = await ctx.params` — NOT `ctx.params.id`)
- [ ] `searchParams` awaited in page components?
- [ ] All API routes wrapped in `try/catch`?
- [ ] Error responses use `{ success: false, error: message }` format?
- [ ] UI shows API errors (not silent failures)?
- [ ] No hand-edited SQL in `drizzle/`?
- [ ] ZERO localStorage/sessionStorage for application data? (only UI preferences like theme)
- [ ] Data fetched from API routes (not from localStorage)?
- [ ] Changed the taxonomy? Regenerate `scripts/cleanup-topic-mastery.sql`.
