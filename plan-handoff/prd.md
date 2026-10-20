I’m grounding the adaptive tutoring flow in the available agent, sandbox, and persistence capabilities before drafting the full product plan.The product shape is settled: one adaptive coaching agent, safe code execution through the available sandbox, and account-scoped progress stored in PostgreSQL. I’m selecting the visual system and drafting the four core screens.



# Embedded Systems Learning Coach

## 1. Overview

Embedded Systems Learning Coach is an adaptive, practice-first tutoring application that initially ships with five connected domains:

- C
- C++
- Linux
- Networking
- Board Support Packages (BSP), including boot flow, bootloaders, drivers, device trees, and hardware integration

Domains are loaded from version-controlled Domain Packs rather than hard-coded into the application. Additional domains can be added and reviewed in source without changing the core learning, assessment, recommendation, or progress interfaces.

The learner begins with a mixed diagnostic rather than self-selecting a level. The coach maintains a separate Basic-to-Expert proficiency rating for every domain and topic. It recommends the next exercise based on demonstrated skill, confidence, recent mistakes, and prerequisite gaps.

The app can also submit approved learning tasks to Claude CLI on a user-controlled Linux host. Claude CLI uses the host’s existing OAuth login; the app never requests, stores, or exposes an Anthropic API key or OAuth credential.

Every learning cycle follows:

1. Attempt a varied exercise.
2. Receive automated tests, analysis, and targeted feedback.
3. Study a short lecture addressing the observed gap.
4. Retry or solve a related exercise.
5. Complete periodic quizzes and milestone challenges.

Exercises include code writing, debugging, code review, output prediction, conceptual quizzes, Linux command labs, network diagnosis, and BSP case studies. The system must never claim that generated or executed code is safe for production hardware without human review.

Success means learners can see their current level, understand why it was assigned, and receive an appropriately challenging next task rather than a generic course sequence.

## 2. User Stories

- As a new learner, I want a mixed diagnostic so the application can estimate my ability in each domain independently.
- As a learner, I want to start solving immediately instead of reading long lectures before practicing.
- As a learner, I want code compiled and tested in an isolated environment so I receive concrete feedback.
- As a learner, I want explanations tied to my mistakes rather than generic textbook summaries.
- As a learner, I want exercises to vary in format, context, and difficulty.
- As a learner, I want hints in stages so I can ask for help without immediately seeing the answer.
- As a learner, I want Linux and networking scenarios that resemble real system failures.
- As a learner, I want challenging adaptive knowledge tests whose results influence my mastery without allowing one test to change my level drastically.
- As an embedded developer, I want BSP exercises involving bootloaders, device trees, memory maps, drivers, interrupts, buses, and board bring-up.
- As a learner, I want separate ratings for C, C++, Linux, Networking, and BSP so strength in one area does not mask a gap in another.
- As a returning learner, I want my submissions, feedback, mastery, streak, and recommended next activity preserved.
- As a learner, I want to review previous attempts and compare them with improved solutions.
- As a learner, I want to launch an approved Claude CLI task from an exercise and inspect its streamed output, exit status, and changed files.
- As a learner, I want expert-level capstones that combine multiple domains without prematurely exposing complete solutions.

## 3.a. Agent Architecture

| Agent Type | Agent Name | Description | Tools/Data Sources | Trigger | Provider | Model | Temperature | Top_p |
|---|---|---|---|---|---|---|---:|---:|
| Single | Embedded Systems Learning Coach | Diagnoses proficiency, generates diverse exercises and concise lectures, evaluates answers, interprets sandbox results, provides staged hints, updates mastery evidence, and recommends the next activity. | E2B isolated sandbox for C/C++ compilation, tests, and safe command-line labs; learner context supplied by the application | Diagnostic submission, exercise request, answer submission, hint request, review request, or next-activity request | Anthropic | anthropic/claude-sonnet-4-6 | 0.3 | 0.9 |

The single-agent design keeps feedback coherent and avoids unnecessary delegation latency. Difficulty selection and progress storage are application and database responsibilities, not additional agents.

The coach must:

- Generate tasks only after receiving the learner’s current mastery and recent-attempt summary.
- Label each activity by domain, topic, level, format, prerequisites, estimated duration, and learning objective.
- Use staged hints: conceptual nudge, focused clue, pseudocode or command outline, then explained solution.
- Distinguish compilation errors, runtime failures, incorrect output, unsafe behavior, style issues, and conceptual misunderstandings.
- Never execute learner code outside the isolated sandbox.
- Avoid privileged, destructive, persistence-changing, or unrestricted network commands in Linux labs.
- Treat BSP labs as simulations or reasoning exercises unless compatible emulated hardware is explicitly available.
- Award mastery from demonstrated evidence, not from lesson completion alone.
- Produce structured results that the UI can validate and render consistently.

## 3.c. Learning and Assessment Model

Each enabled Domain Pack supplies a prerequisite graph and uses five shared visible bands:

1. **Basic** — syntax, terminology, and guided use
2. **Foundation** — routine tasks with limited guidance
3. **Intermediate** — multi-step implementation and diagnosis
4. **Advanced** — tradeoffs, performance, concurrency, and system interaction
5. **Expert** — ambiguous failures, architecture, optimization, and cross-domain capstones

The learner also receives a numeric mastery score per topic. Initial placement uses a mixed diagnostic with adaptive follow-ups. Later estimates consider correctness, test coverage, hint usage, retries, reasoning quality, recency, and performance across more than one exercise format.

A level rises only after repeated evidence. A single failure lowers confidence but does not erase established mastery. The UI explains every rating using recent evidence and suggests what would move it upward.

### Adaptive Lecture Generation

Lectures are generated on demand from diagnostic evidence, the current attempt, compiler or runtime output, hint usage, prior misconceptions, topic prerequisites, and mastery confidence. Each lecture targets one or two measurable learning objectives rather than regenerating an entire course chapter.

The coach automatically chooses the lecture depth:

- **Quick correction, 2–5 minutes:** one isolated mistake with high-confidence prerequisite mastery.
- **Micro-lecture, 5–10 minutes:** a focused conceptual gap or recurring implementation error.
- **Standard lesson, 10–20 minutes:** several connected gaps or weak prerequisite confidence.
- **Deep dive, 20–30 minutes:** advanced tradeoffs, repeated failure, cross-domain reasoning, or an expert topic.

Every generated lecture contains an applied context, intuitive explanation, core rules, domain-appropriate example, common failure mode, debugging method, concise recap, retrieval check, and transfer exercise. C/C++ lessons may use code and memory diagrams; Linux lessons use commands and logs; Networking lessons use packet flows and topology; BSP lessons use boot traces, device trees, linker scripts, memory maps, and register-level scenarios.

The initial length is selected automatically, but the learner can choose **Explain more**, **Make it shorter**, **Show another example**, or **Review prerequisites**. After the retrieval check, the coach may shorten the path, provide a different explanation, descend to a missing prerequisite, or continue into a deeper lesson. Reading a lecture never increases mastery by itself; only demonstrated understanding and successful application create mastery evidence.

## 3.d. Curriculum Scope

### Domain Pack Architecture

Every domain is a version-controlled, validated source module with a stable, namespaced ID. A Domain Pack declares:

- Name, description, icon key, version, and supported app version.
- Topic IDs, Basic-to-Expert outcomes, and prerequisite edges.
- Optional prerequisites that reference stable topic IDs in other packs.
- Supported exercise formats and diversity constraints.
- Diagnostic blueprint, lecture guidance, rubrics, mastery thresholds, and capstone rules.
- Runtime profiles: no execution, E2B sandbox, Claude CLI through the approved MCP bridge, or a separately approved integration.
- Domain-specific safety policy, prohibited operations, resource limits, and artifact types.
- Curated examples and validation fixtures used to check generated content and scoring behavior.

A central source registry enables packs and controls their display order. The dashboard, diagnostic engine, Skill Map, recommendation engine, and coach prompt consume the same registry; none may switch on a fixed list of domain names.

Each pack must pass schema validation, unique-ID and prerequisite-cycle checks, runtime-policy validation, and fixture tests during build. Packs are reviewed in source and deployed with the application; version one has no in-app creation, import, editing, or publishing interface.

Removing or renaming an ID must not orphan historical learning records. Topic IDs remain immutable after release; deprecation hides a topic from new recommendations while preserving its lectures, attempts, and mastery history. Pack migrations explicitly map replaced IDs.

### Initial Domain Packs

### C

Types, control flow, functions, arrays, pointers, memory layout, structs, bit operations, compilation, linking, undefined behavior, dynamic memory, callbacks, concurrency fundamentals, embedded constraints, and optimization.

### C++

Core syntax, object lifetime, RAII, classes, templates, STL, move semantics, smart pointers, error handling, concurrency, metaprogramming, performance, interoperability with C, and embedded C++ constraints.

### Linux

Shell navigation, permissions, processes, signals, filesystems, pipes, text tools, system calls, services, logs, build tools, debugging, memory and performance inspection, cross-compilation, and constrained-system troubleshooting.

### Networking

OSI and TCP/IP models, addressing, subnetting, ARP, ICMP, UDP, TCP, sockets, DNS, routing, packet interpretation, client/server design, timeouts, retransmission, concurrency, diagnostics, performance, and embedded protocols.

### BSP

Boot sequence, memory maps, linker scripts, startup code, U-Boot concepts, device trees, pin multiplexing, clocks, interrupts, GPIO, UART, I²C, SPI, drivers, kernel integration, root filesystems, cross-toolchains, board bring-up, failure isolation, and hardware-facing safety.

## 3.e. Exercise Diversity and Assessment Rules

The coach rotates among:

- Write or complete code
- Repair failing code
- Review code and identify defects
- Predict output or behavior
- Explain a concept or tradeoff
- Interpret compiler, linker, kernel, or network logs
- Run a guided Linux lab
- Diagnose a network topology or packet trace
- Design tests for an existing implementation
- Refactor for safety, clarity, or performance
- Analyze a BSP bring-up incident
- Complete a multi-domain capstone

It must avoid giving the same format more than twice consecutively and avoid superficial variable-renaming as “new” diversity. Generated tasks should vary by objective, failure mode, constraints, and solution strategy.

### Adaptive Knowledge Tests

The Learning Coach also provides three assessment modes:

1. **Knowledge Check** — 5–10 adaptive questions after a lesson or practice gap.
2. **Domain Assessment** — 20–40 questions with an optional time limit, broad topic coverage, and enough evidence to confirm a domain level.
3. **Expert Challenge** — fewer but deeper multi-step scenarios that may combine several domains.

Each Domain Pack supplies version-controlled question blueprints, learning objectives, misconception-based distractor guidance, answer rules, difficulty parameters, and scoring rubrics. The coach generates parameterized variants from these blueprints rather than inventing unconstrained trivia.

Supported question forms include single-answer and multiple-answer selection, insufficient-information choices, code or command output prediction, compiler and runtime diagnosis, Linux log analysis, packet and topology interpretation, boot-log diagnosis, device-tree and linker-map analysis, and multi-step scenarios requiring both a selection and written justification.

Question difficulty is determined from prerequisite depth, number of reasoning steps, distractor plausibility, ambiguity, permitted support, and observed learner performance—not merely an agent-assigned label. Advanced and Expert tests emphasize application, diagnosis, tradeoffs, and cross-domain reasoning rather than recall.

Before a generated question can affect mastery, the coach must verify:

- The stem contains enough information and has no unintended ambiguity.
- The answer key follows from the supplied artifacts and rubric.
- Distractors represent plausible misconceptions without trick wording.
- Single-answer questions have exactly one defensible answer.
- Multiple-answer questions define partial-credit and over-selection rules.
- Executable C/C++ questions are checked in E2B when execution can establish the answer.
- No answer, explanation, hidden rubric, or reference solution leaks before submission.

A question that fails validation, is successfully challenged as ambiguous, or produces inconsistent verification is excluded from scoring and mastery evidence.

### Controlled Mastery Impact

Assessment results directly update topic mastery only when the test contains sufficient independent evidence and reaches a configured confidence threshold. Updates are weighted by calibrated difficulty, topic coverage, correctness, partial credit, written reasoning, hint usage, response consistency, and recency.

A single assessment has a strict upward and downward change cap and cannot independently move a learner by more than one visible level band. Correct answers with weak or contradictory reasoning contribute less evidence; isolated wrong answers lower confidence before materially lowering established mastery. Repeated evidence across different question variants and formats is required for a durable level change.

After submission, the learner receives the score, topic-by-topic evidence, explanations, misconception analysis, mastery impact, and recommended remediation. The review never reveals reusable hidden-test internals or future answer variants.

## 3.f. Structured Agent Output

The application expects:

- Activity metadata and instructions
- Optional starter files
- Allowed execution profile and test plan
- Public test feedback
- Hidden-test summary without exposing hidden cases
- Correctness and reasoning evaluation
- Safety findings
- Staged hints
- An adaptive lecture plan containing selected depth, estimated duration, learning objectives, evidence-based rationale, sections, examples, retrieval check, and transfer exercise
- Assessment metadata containing mode, blueprint and version, topic coverage, calibrated difficulty, question validation state, answer rules, score, confidence, and mastery-impact cap
- Mastery evidence by topic
- Recommended next activity
- A learner-facing explanation of any level change

Claude CLI execution is an application runtime capability rather than another tutoring agent. The app sends a constrained job to an MCP bridge running on the authenticated Linux host. The bridge starts the installed `claude` command under the host’s existing OAuth session and returns job status, streamed stdout/stderr, exit code, timeout reason, and a manifest or diff of changed files.

Each job receives an isolated temporary working directory owned by the requesting learner’s attempt. The bridge must use an argument allowlist, bounded runtime and output, concurrency limits, environment-variable scrubbing, process-tree termination, and an auditable job ID. It must reject arbitrary shell composition, privileged commands, host-wide paths, credential-file access, and Claude CLI permission-bypass flags. OAuth files remain inaccessible to the web app, tutoring agent, learner code, and E2B sandbox.

Because one Linux OAuth session is shared, every authorized app user consumes the same Claude account quota and acts under the same upstream identity. The app must show this clearly before execution and associate every job with the authenticated app user for auditing.

Reference solutions remain concealed until the learner requests the final hint or submits a completed attempt for review.

## 3.g. Database Configuration

Use the built-in PostgreSQL database with email/password registration and login. Every application screen is authenticated and every learner-owned record is scoped to its owner.

Core tables:

- **learner_profiles** — preferences, goals, available study time, diagnostic status
- **topic_mastery** — immutable `domain_id` and `topic_id` from the source registry, numeric score, level band, confidence, evidence summary, pack version, and last assessed time
- **activities** — generated exercise or lecture metadata, immutable domain and topic IDs, Domain Pack version, difficulty, format, prompt, starter assets, and rubric
- **attempts** — learner response, execution result, score, hint count, feedback, completion state, timestamps
- **learning_events** — immutable evidence used to explain mastery changes
- **study_sessions** — session duration, activities attempted, outcomes, and recap
- **recommendations** — queued next activities and the rationale for each recommendation
- **assessment_sessions** — assessment mode, Domain Pack versions, topic coverage, timing policy, status, score, confidence, and bounded mastery impact
- **assessment_items** — generated question variant, source blueprint, difficulty factors, validation evidence, answer rules, and immutable review snapshot
- **assessment_responses** — selected answers, written justification, response time, partial credit, feedback, challenge status, and resulting mastery evidence

Domain definitions and question blueprints remain in version-controlled source and are not editable database records. PostgreSQL stores references to immutable Domain Pack IDs and versions so historical attempts remain interpretable after a pack evolves.

Application data must use PostgreSQL rather than browser storage. Authenticated client requests use bearer-authenticated application routes. Seed each new account with a short mixed diagnostic generated from all enabled Domain Packs and a sample topic map; do not seed fake completed progress.

## 4. User Flow

1. The visitor chooses Login or Sign Up.
2. After authentication, a first-time learner enters goals, prior experience, and preferred session length.
3. The app presents a mixed diagnostic across all five domains, adapting follow-up questions to responses.
4. The learner receives a Skill Map with a separate level, confidence, and evidence summary for each domain.
5. The dashboard recommends one primary activity and offers domain-specific alternatives.
6. Opening an activity shows the task, constraints, editor or answer controls, staged hints, and relevant files or scenario details.
7. For normal executable tasks, the learner runs code or commands in the isolated E2B sandbox and sees compile, test, runtime, and safety results.
8. For an activity that explicitly supports Claude CLI, the learner reviews the prompt, permitted workspace, resource limits, and shared-account notice before starting the job.
9. The app submits the approved job to the Linux MCP bridge, streams sanitized Claude CLI output, and displays the exit status and changed-file diff without exposing OAuth data or unrelated host files.
10. On submission, the coach evaluates both the answer and reasoning.
11. If a gap is detected, the coach selects an appropriate lecture depth from quick correction through deep dive, explains why that depth was selected, and generates a targeted lesson.
12. The learner completes a retrieval check and transfer exercise; the coach then continues, changes the explanation, reviews a prerequisite, or recommends a related retry.
13. Mastery and recommendation records update only after the learner demonstrates understanding.
14. The learner reviews the result, compares attempts, or starts the recommended next activity.
15. After lessons, the learner may receive a short adaptive Knowledge Check; at milestones, the learner receives a Domain Assessment or cross-domain Expert Challenge.
16. During an assessment, the app adapts upcoming question difficulty without revealing correctness, answers, or hidden rubrics until submission.
17. After submission, invalid questions are excluded, mastery changes are capped and confidence-weighted, and the learner receives topic evidence, explanations, and remediation.
18. The Progress screen explains current levels, confidence, assessment evidence, recent practice, and the shortest path toward the next band.

## 5. Integrations Required

| Integration | Source | Purpose | Agent actions |
|---|---|---|---|
| E2B | aci | Isolated execution for C/C++ compilation, unit tests, sanitizers, and restricted Linux command labs | Use the single sandbox execution action available in the live E2B integration; enforce time, resource, filesystem, privilege, and network restrictions in the execution profile |

### Required Claude CLI connection

The current workspace has no MCP server exposing the Linux-hosted Claude CLI, so this capability cannot be enabled yet. Add an MCP server through **+ → Add MCP server** in the message composer. The server should run on, or securely reach, the Linux machine where `claude` is installed and already authenticated through OAuth. It must expose constrained job operations—not a general-purpose remote shell—for starting a job, reading or streaming status, cancelling it, and retrieving the changed-file manifest or diff.

After the MCP server is attached, its live server ID and exact tool names must replace this pending connection note and be copied into the relevant runtime configuration before build handoff. No Anthropic API key is required or stored by the app.

No live hardware-control integration is planned. BSP work is presented through simulations, source analysis, logs, configuration fragments, and case studies. If real board flashing, serial-console access, or hardware telemetry is later required, add an appropriate custom tool through **+ → Add custom tool** before enabling those operations.

## 6. UI/UX Specification

The visual system uses the Catppuccin theme: calm developer-oriented surfaces, muted indigo accents, compact radii, and readable typography. The application supports both light and dark modes with an app-owned toggle.

All authenticated screens share a compact left navigation for Home, Learn, Skill Map, History, and Profile. The header shows the current streak, global activity progress, theme control, and account menu.

**Login + Sign Up:** A focused split layout explains practice-first coaching beside the authentication form. Avoid marketing clutter.

**Home:** Lead with one prominent “Recommended next” card containing objective, domain, difficulty, format, duration, and the evidence behind the recommendation. Below it, render compact meters for every enabled Domain Pack and recent attempts; the initial release displays five.

**Practice Workspace:** Use a resizable task/editor composition. The task pane contains requirements, constraints, files, and staged hints. The work pane contains tabs for editor, terminal, tests, Claude CLI, and notes. A persistent action bar offers Run, Submit, and Save draft. Claude-enabled tasks show the exact prompt, temporary workspace scope, limits, shared OAuth-account notice, running state, sanitized output, cancel control, exit status, and changed-file diff. Feedback must distinguish compiler, test, runtime, Claude CLI, safety, and conceptual findings.

**Assessment Workspace:** Reuse the focused workspace shell in an assessment mode with progress, topic coverage, optional timer, question stem, supporting code/log/diagram artifacts, answer controls, confidence input, and optional written justification. Do not show correctness while the assessment is active. Submission opens a review organized by topic, with explanations, invalidated questions, misconception patterns, bounded mastery impact, and recommended follow-up practice.

**Result & Review:** Show outcome first, then test evidence, coach feedback, mastery impact, and retry/next actions. When teaching is needed, show the automatically selected lecture depth, estimated duration, learning objectives, and a short reason for the selection. Present the lesson in progressive sections with controls for Explain more, Make it shorter, Another example, and Review prerequisites, followed by a retrieval check and transfer exercise. Never reduce feedback to a score alone or award mastery merely for reading the lesson.

**Skill Map:** Present one responsive column or selectable lane per enabled Domain Pack, with topic nodes, confidence, prerequisites, and recent evidence. The initial release presents five domains; additional packs appear automatically without a screen-specific code change. Selecting a topic opens its rating explanation and recommended practice.

Use semantic status colors in addition to icons and labels. Code and logs use monospace typography. Keyboard navigation, visible focus, accessible contrast, and non-color-only status indicators are required.

## Artifacts & references

- Theme: `tw:catppuccin`
- Hosted agent: Lyzr default agent using `Anthropic` / `anthropic/claude-sonnet-4-6`
- Execution: E2B isolated sandbox through the available `aci` integration
- Claude CLI: pending MCP bridge to a user-controlled Linux host with an existing OAuth login; no Anthropic API key
- Persistence: built-in PostgreSQL with owner-scoped records and email/password authentication
- Domain extension: validated, version-controlled Domain Packs registered in source; no version-one administration UI
- Core mockup: four primary authenticated application surfaces below