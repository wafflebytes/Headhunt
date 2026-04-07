# Headhunt — Repo Operating Manual

This doc is a **detailed runbook** for AI agents and contributors working in this repository.

It is written to help you:

- navigate the codebase quickly
- understand execution paths (interactive chat vs automation)
- modify behavior safely (idempotency, approvals, guardrails)
- debug common failures without guessing

If anything in this doc conflicts with the repo’s product intent, **`plan.md` is the priority source of truth**, then `product/headhunt-spec-v1.md`.

---

## North star

Ship a demo-ready “autonomous hiring” system that is **Authorized to Act**:

- It does useful work autonomously (intake/triage/scoring/scheduling).
- It keeps humans in control for high-stakes actions (offer release).
- It uses security primitives rather than trust-by-convention:
  - **Auth0 Token Vault** for third-party tokens
  - **Auth0 FGA** for capability boundaries
  - **CIBA (Guardian push)** as step-up approval

---

## Source-of-truth docs

- `plan.md` — demo-first execution plan + work tracker (priority #1)
- `product/headhunt-spec-v1.md` — product behavior and UX spec (priority #2)

Useful supporting docs:

- `product/headhunt-demo-6-phase-plan.md` — staged demo narrative
- `product/headhunt-tracker.md` — build/checklist tracking

---

## Stack map (what runs where)

### Web app (interactive)

- **Next.js App Router** under `src/app`
- UI + API routes (including chat endpoint)
- Vercel AI SDK-based tool calling for in-app agent experiences

### Automation runtime (headless)

- **Vercel Cron** triggers the intake endpoint (`vercel.json`)
- The cron endpoint proxies to **Supabase Edge Functions**
- Supabase calls back into the app to execute deterministic handlers

Why this split exists:

- interactive UX is best in Next.js
- background orchestration is more robust as a queue + deterministic handler execution
- headless execution prefers M2M / server-to-server credentials over cookies

### Data layer

- Postgres + Drizzle
- Local dev uses Docker (see `docker-compose.yml`)

### MCP server

- `mcp-server/*` implements a FastMCP server
- Auth is via JWT verification (typically Auth0 as issuer)
- Exposes pipeline/job/candidate tooling to external MCP clients

---

## Repository layout (high-signal directories)

- `src/app/*` — UI + Next.js route handlers
- `src/lib/*` — domain logic, prompts, automation engine, DB
- `src/lib/automation/queue.ts` — core handler routing + enqueue/execute behavior
- `supabase/functions/*` — edge functions (cron + webhooks + agent facades)
- `mcp-server/*` — FastMCP server + tool definitions
- `product/*` — product specs, demo plans, seed scripts
- `scripts/*` — local scripts / utilities

---

## Mental model: “5 agents, 2 runtimes, 1 queue”

### The five agents

Headhunt’s behavior is described as a 5-agent crew:

- **Intercept** — reads signals: threads, attachments, calendar data
- **Triage** — classifies inbound and chooses a next action
- **Analyst** — deep candidate evaluation and structured scoring
- **Liaison** — scheduling orchestration end-to-end
- **Dispatch** — offer workflow and high-stakes release gating

These “agents” are implemented as a combination of:

- prompt + toolchains in interactive routes
- deterministic automation handlers scheduled by the queue

### Two runtimes

1) **Interactive runtime**

- used when the founder is in the UI
- great for “do this now” and explainability

2) **Automation runtime**

- used for polling, webhooks, long-running work, retries
- runs “one handler at a time” based on `{ handlerType, payload }`

### One queue

The automation queue is the system-of-record for background tasks:

- Enqueue work with idempotency keys
- Execute deterministic handlers
- Persist outcomes and audit trails
- Retry or dead-letter safely

---

## Execution wiring (cron → supabase → app)

High-level path:

1. Vercel Cron calls `GET/POST /api/cron/intake-polling`
2. The route authenticates via cron secret, then forwards to Supabase Edge Function `v2-orchestrator-cron`
3. The orchestrator decides what to enqueue (scan inbox, process pending threads, etc.)
4. Supabase calls back into `POST /api/automation/execute`
5. The execute route runs a single automation handler and stores results

Practical implications:

- If the cron is “working” but nothing changes in the UI, trace:
  - cron route auth → supabase invocation → supabase logs → execute endpoint auth → handler execution

---

## Core flows (what to change, where)

### Flow A — Inbox intake → candidate → pipeline

Intent:

- A founder connects Gmail.
- New messages arrive (often with PDF resumes).
- System extracts candidate info and moves them into pipeline stages.

Typical stages:

1) **Intercept**

- fetch thread + message content
- fetch / store attachments
- normalize into a compact “intake bundle”

2) **Triage**

- classify message into one of:
  - application/intake
  - scheduling reply
  - unrelated/no-op
- output a decision + confidence and a structured reason

3) **Analyst**

- multi-pass evaluation
- produce:
  - objective score
  - confidence score
  - strengths/risks/breakdown
- persist the structured output for the UI

Where to look:

- handler routing + core orchestration: `src/lib/automation/queue.ts`
- DB models: `src/lib/db/schema/*`
- UI pipeline rendering: `src/app/*` (search for pipeline board components)

Safe change guidance:

- preserve idempotency (avoid duplicate candidates from the same thread)
- keep triage cheap; expensive reasoning belongs in Analyst
- store structured outputs; don’t only log narrative strings

### Flow B — Scheduling (3 options total, 1 per day)

Intent:

- Propose interview slots like a human coordinator.
- Avoid overwhelming candidates with too many options.

Constraints:

- **3 options total**
- **1 option per day**
- Always re-check overlap before booking (slots can go stale)

Typical stages:

1) pick provider (Cal.com primary, Google fallback if configured)
2) fetch live availability
3) generate the 3 options
4) send an email (often as a draft during debugging)
5) parse reply (option number or freeform time window)
6) re-check overlap
7) book + update pipeline state

Where to look:

- scheduling handlers: `src/lib/automation/queue.ts` (search handlerType strings)
- calendar integrations: `src/lib/*` (search for Cal / calendar tokens)

Safe change guidance:

- default `sendMode` to draft during debugging or tests
- do not auto-send follow-ups from slash commands without explicit user intent
- handle ambiguous replies by selecting a safe fallback (request clarification) rather than booking incorrectly

### Flow C — Offer draft → approval (CIBA) → release

Intent:

- Draft is easy; sending is gated.
- Founder must approve via step-up (Guardian push).

Typical stages:

1) create offer draft
2) request CIBA authorization
3) wait for approval
4) only then send / finalize

Where to look:

- offer handlers: `src/lib/automation/queue.ts`
- Auth0 CIBA integration: search `CIBA` under `src/`

Safe change guidance:

- never bypass CIBA gate for offer release
- store an audit trail for “who approved what”

---

## Auth0 integrations (what they’re for)

### Token Vault

Purpose:

- store third-party OAuth tokens outside app DB
- let agents/tools access provider APIs safely

Common failure mode:

- connected account lacks refresh-capable consent
- fix by reconnecting with consent + offline access (where supported)

### Machine-to-machine (M2M) runtime

Purpose:

- let automation run without user cookies
- deterministic job execution

Expected env vars:

- `AUTH0_TOKEN_VAULT_M2M_CLIENT_ID`
- `AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET`
- `AUTH0_TOKEN_VAULT_M2M_AUDIENCE`

### CIBA (approval)

Purpose:

- step-up approval for irreversible actions

Implementation guidance:

- CIBA must be an explicit “gate” state in the offer release flow
- treat denial/timeouts as terminal or manual-review states

### FGA (capabilities)

Purpose:

- enforce roles/capabilities server-side
- keep UI honest (UI can hide buttons; FGA blocks execution)

Expected env vars:

- `FGA_STORE_ID`
- `FGA_CLIENT_ID`
- `FGA_CLIENT_SECRET`
- `FGA_API_URL`
- `FGA_API_AUDIENCE`

---

## Environment variables (grouped)

Use `.env.example` as canonical.

### App / Auth0 session

- `APP_BASE_URL`
- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_SECRET`

### Token Vault + M2M

- `AUTH0_TOKEN_VAULT_*`
- `AUTH0_TOKEN_VAULT_M2M_*`

### Management API fallback (for robustness)

If you use the Management API to retrieve federated tokens, you must configure:

- `AUTH0_MANAGEMENT_CLIENT_ID`
- `AUTH0_MANAGEMENT_CLIENT_SECRET`
- `AUTH0_MANAGEMENT_AUDIENCE`
- `AUTH0_MANAGEMENT_SCOPE` (must include `read:federated_connections_tokens`)

### Database

- `DATABASE_URL`

### LLM provider

- `NIM_API_KEY`

### Automation secrets

- `CRON_SECRET` / `AUTOMATION_CRON_SECRET`
- `AUTOMATION_EXECUTE_SECRET` (for `/api/automation/execute`)

### MCP server

- `MCP_AUTH_AUDIENCE`
- `MCP_AUTH_ISSUER`
- `MCP_PORT`
- `MCP_ENDPOINT`

---

## Commands (common recipes)

### Local dev

```bash
npm install
docker compose up -d
cp .env.example .env.local
npm run db:migrate
npm run fga:init
npm run dev
```

### MCP server

```bash
npm run mcp:http
```

Dev-only stdio:

```bash
npm run mcp:stdio
```

### Clean rebuild (Next.js gotcha)

If you see `PageNotFoundError` or stale build artifacts:

```bash
rm -rf .next
npm run build
```

---

## Debugging playbook

### Symptom: cron runs, but intake does nothing

Checklist:

- Is `vercel.json` cron deployed and the endpoint reachable?
- Does `/api/cron/intake-polling` accept your auth header?
- Are Supabase function secrets set and functions deployed?
- Do you see supabase logs for `v2-orchestrator-cron`?
- Does Supabase successfully call `/api/automation/execute`?
- Does `/api/automation/execute` accept `AUTOMATION_EXECUTE_SECRET`?
- Are handler runs persisted (check `automation_runs`) and are they failing/retrying?

### Symptom: repeated auth/token logs or refresh loops

- suspect in-flight token request duplication
- ensure refresh isn’t attempted for still-fresh JWTs
- add a short cooldown on refresh retries

### Symptom: tool output shows serialized parts (tool-call/tool-result)

- sanitize assistant message rendering
- handle both typed tool parts and legacy shapes

### Symptom: scheduling booked the wrong slot

- validate the “3 options total, 1/day” slot generation
- confirm reply parsing and timezone normalization
- ensure overlap re-check runs immediately before booking

---

## Guardrails (non-negotiables)

- Do not auto-send irreversible messages without explicit user intent.
- Keep offer release behind a CIBA approval gate.
- Prefer prompt changes in `src/lib/prompts/*` (or equivalent prompt modules) over hardcoding behavior inside tool execution.
- Avoid leaking third-party tokens into logs.
- Maintain idempotency: add idempotency keys when scheduling or ingesting.
