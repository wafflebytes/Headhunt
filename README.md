# Headhunt — hire at founder speed

Headhunt is an autonomous, agentic recruiting platform for early-stage founders.

Connect Gmail, Cal.com, and Slack via **Auth0 for AI Agents Token Vault**. A crew of five agents runs the pipeline in the background. You step in only when it’s time to approve something high-stakes.

**Demo video (≤ 3 minutes):** <ADD_VIDEO_LINK>  
**Live app:** <ADD_PUBLIC_URL>  
**Devpost:** <ADD_DEVPOST_LINK>

**Test user (for judges/testing):**

```text
Email: test@test.com
Password: Headhunt@123
```

---

## What it does

- **Intercepts** candidate emails + resume attachments from Gmail.
- **Triages** inbound threads into the right lane (application vs scheduling reply vs noise).
- **Analyzes** candidates with multi-pass scoring (objective score + confidence + breakdown).
- **Schedules** interviews by fetching live availability, proposing **3 options total (1 per day)**, then booking.
- **Drafts** offer letters and requires a founder approval gate (CIBA) before sending.

This README follows the execution flow in `plan.md` (priority 1), then product logic from `product/headhunt-spec-v1.md`.

---

## Contents

- Demo flow
- System architecture
- Hackathon rubric (judge checklist)
- Screenshots
- Local development
- Deployment (Vercel + Supabase)
- MCP server (FastMCP)
- Agent skill doc
- Credits / non-commercial note

---

## Demo flow (Plan v2)

1. Log in as a founder.
2. Finish onboarding (connect Gmail + Slack + Cal.com via Token Vault).
3. Enter the dashboard.
4. A first intake run triggers automatically post-onboarding.
5. Send an application email with a resume PDF attached.
6. Headhunt triages + analyzes the candidate and updates the pipeline.
7. Schedule an interview from the pipeline: pick a provider (Cal.com or Google Meet fallback) and select slots.
8. Candidate replies; Headhunt parses the reply, rechecks overlap, and books.
9. Draft an offer from Cmd+K.
10. Founder receives a CIBA push and approves in Auth0 Guardian.
11. Offer is released only after approval; pipeline state updates everywhere.

---

## System architecture (how it works)

### The 5-agent crew

- **Intercept** — ingests inbox signals (thread, body, attachments).
- **Triage** — classifies inbound messages and decides whether to write pipeline state.
- **Analyst** — deep candidate evaluation with multi-pass scoring.
- **Liaison** — scheduling orchestration: slots → outreach → reply parsing → booking.
- **Dispatch** — offer workflow (draft → CIBA approval → send).

### Execution surfaces

Headhunt has two ways to run agent work:

1) **Interactive operator runtime (in-app)**

- Next.js UI (App Router) under `src/app`.
- Tool-calling agent runtime under `src/app/api/chat/route.ts` (Vercel AI SDK).

2) **Headless automation runtime (cron/webhook/worker style)**

- **Vercel Cron** triggers `GET/POST /api/cron/intake-polling` (configured in `vercel.json`).
- That route proxies to Supabase Edge Function: `v2-orchestrator-cron`.
- Supabase orchestration calls back into the app via `POST /api/automation/execute` to execute specific handler types.

This gives you:

- cookie-independent execution when M2M is configured
- deterministic handler execution
- observable run state in the database

### Automation queue (idempotent by design)

The automation runtime is a persistent queue:

- Queue table: `automation_runs` (Drizzle schema in `src/lib/db/schema/automation-runs.ts`)
- Audit table: `audit_logs`
- Core engine: `src/lib/automation/queue.ts`

Key properties:

- **Idempotency:** inserts use `(handlerType, idempotencyKey)` conflict protection.
- **Retries:** runs can retry with backoff and end in `dead_letter` when terminal.
- **Separation of concerns:** orchestration (cron/webhooks) schedules work; execution runs a single handler deterministically.

Common handler types you’ll see:

- `intake.scan`
- `candidate.score`
- `scheduling.request.send`
- `scheduling.reply.parse_book`
- `offer.draft.create`
- `offer.submit.*` / approval + send flows

### Triage (classification)

Triage is built to be cheap and decisive:

- one structured `generateObject` classification pass
- outputs a classification + confidence (e.g. application vs scheduling reply)
- only “application” results trigger candidate/application persistence

### Analyst (multi-pass scoring)

Analyst is built to be strict:

- multiple evaluator passes (not surface-level filtering)
- produces distinct **objective score** and **confidence score** plus a breakdown
- persists structured output to candidate records so the UI can render instantly

### Scheduling (Cal.com + Google Meet fallback)

Scheduling is designed to feel like a human coordinator:

- fetch live slots
- propose **3 options total (1 per day)** across the next few days
- parse the candidate reply (option number or freeform window)
- recheck overlap to avoid stale selections
- book and move the candidate stage forward

---

## Built for “Authorized to Act” (judge checklist)

**Security model**

- Token Vault holds OAuth tokens; agents don’t handle raw credentials.
- Headless execution uses an M2M app rather than replaying user cookies.
- High-stakes actions are gated with step-up approval (CIBA).

**User control**

- Role enforcement is handled via Auth0 FGA checks, not only UI.
- All important transitions are persisted and auditable.

**Technical execution**

- Next.js 15 + Vercel AI SDK for interactive tool-calling.
- Supabase Edge Functions + Vercel Cron for automation.
- FastMCP server to expose the pipeline to any MCP client.

**Design**

- Operator-first UI: pipeline board, candidate detail, and command-center actions.

**Insight value**

- CIBA used as a delegation escalation gate: draft is easy, release is protected.

---

## Screenshots (drop in your own images)

Create `docs/images/*` and replace the placeholders below.

| | |
| --- | --- |
| ![Landing Page](docs/images/landing.png)<br/><sub>Landing page</sub> | ![Dashboard](docs/images/dashboard.png)<br/><sub>Dashboard</sub> |
| ![Pipeline](docs/images/pipeline.png)<br/><sub>Pipeline (Applied → Interview → Offer)</sub> | ![Jobs](docs/images/jobs.png)<br/><sub>Jobs</sub> |
| ![Candidate](docs/images/candidate.png)<br/><sub>Candidate detail (score + intel)</sub> | ![Scheduling](docs/images/scheduling.png)<br/><sub>Scheduling modal (slots + provider)</sub> |

---

## Local development

### Prerequisites

- Node.js `>=18`
- Docker (for Postgres + pgvector)

### 1) Install dependencies

```bash
npm install
```

### 2) Start the database

```bash
docker compose up -d
```

### 3) Configure environment

```bash
cp .env.example .env.local
```

Minimum envs for local dev:

- `NIM_API_KEY`
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`
- `DATABASE_URL`
- `FGA_STORE_ID`, `FGA_CLIENT_ID`, `FGA_CLIENT_SECRET`, `FGA_API_URL`, `FGA_API_AUDIENCE`

### 4) Migrate DB + initialize FGA

```bash
npm run db:migrate
npm run fga:init
```

### 5) Run the app

```bash
npm run dev
```

Optional:

```bash
npm run lint
npm run seed:demo
```

---

## Deployment (Vercel + Supabase)

### Vercel

- Set all required env vars from `.env.example`.
- Configure a cron auth secret:
  - `CRON_SECRET` (or `AUTOMATION_CRON_SECRET`)

Cron endpoint:

- `GET/POST /api/cron/intake-polling`
- schedule is configured in `vercel.json`

You can also trigger it manually:

```bash
curl -X POST "https://<your-app-domain>/api/cron/intake-polling" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  --data '{}'
```

### Supabase Edge Functions

Edge functions live under `supabase/functions/*` (legacy and `v2-*`). The recommended wiring uses:

- `v2-orchestrator-cron`
- `v2-webhook-candidate-created`
- `v2-webhook-offer-status`
- `v2-agent-*` facades (intercept/triage/analyst/liaison/dispatch)

Set secrets (names in `.env.example`) and deploy functions. Then wire DB webhooks for inserts/updates that should enqueue work.

---

## Auth0 setup (Token Vault + M2M + CIBA)

Headhunt is built to run without fragile cookie forwarding. The clean setup is:

1) **Auth0 Web App** for interactive login
2) **Auth0 Machine-to-Machine (M2M) App** for headless execution
3) **Token Vault** connections (Google, Cal.com, Slack)
4) **CIBA + Guardian Push** for step-up approval
5) **Auth0 FGA** for role enforcement

### M2M (headless) env vars

- `AUTH0_TOKEN_VAULT_M2M_CLIENT_ID`
- `AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET`
- `AUTH0_TOKEN_VAULT_M2M_AUDIENCE`

### Offer approval (CIBA)

- Enable the CIBA grant type.
- Enable Guardian push and enroll the founder user.
- Set:
  - `HEADHUNT_FOUNDER_USER_ID` (or `HEADHUNT_FOUNDER_USER_IDS`)
  - `AUTH0_CIBA_AUDIENCE`
  - `AUTH0_CIBA_SCOPE`

### Management API fallback (recommended for robustness)

If token exchange isn’t available in a given environment, Headhunt can fall back to the Auth0 **Management API** to retrieve federated connection token material (requires explicit permissions).

- `AUTH0_MANAGEMENT_CLIENT_ID`
- `AUTH0_MANAGEMENT_CLIENT_SECRET`
- `AUTH0_MANAGEMENT_AUDIENCE` (typically `https://YOUR_DOMAIN/api/v2/`)
- `AUTH0_MANAGEMENT_SCOPE` (must include `read:federated_connections_tokens`)

---

## MCP server (FastMCP)

This repo includes an MCP server so you can query jobs/pipeline/candidate details from any MCP-compatible client.

### Run locally

```bash
npm run mcp:http
```

Or for local dev-only stdio:

```bash
npm run mcp:stdio
```

Env vars:

- `MCP_AUTH_AUDIENCE`
- `MCP_AUTH_ISSUER` (optional; defaults to `AUTH0_DOMAIN`)
- `MCP_PORT`, `MCP_ENDPOINT` (optional)

Tools exposed include:

- `list_jobs`
- `list_pipeline`
- `get_candidate_detail`
- `summarize_pipeline_health`

### Example prompts (copy/paste)

- “List my jobs, then show my pipeline for the most recent job. Return the top candidates by score and any stalled stages.”
- “Summarize pipeline health across all jobs and tell me what to do next.”

---

## Agent skill doc

See `skills/SKILL.md` for a detailed “operating manual” designed for AI agents and contributors.

---

## Credits

- **Agentation** (by Benji Taylor)
- Auth0 for AI Agents — Token Vault, CIBA, and FGA
- Next.js, Vercel AI SDK, Supabase, Drizzle, FastMCP

---

## Non-commercial note

This project is MIT licensed, but the current intent is non-commercial, demo/hackathon usage only.
