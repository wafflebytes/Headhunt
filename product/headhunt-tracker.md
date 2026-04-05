# Headhunt Tracker - Full Flow Execution

Last updated: 2026-04-05
Owner: Lead Founding Engineer
Execution mode: ship plumbing first, polish later
Current implementation focus: M2.4 clearance reliability + M2.6 MCP stabilization under demo-phase operator control (Cal-first scheduling is the default).

## Legend

- [x] done
- [/] active
- [ ] queued
- [!] blocked

Execution rule: implementation checkboxes can move to done only when that section's acceptance checks are satisfied; otherwise keep the section in active.

## Non-Negotiable Principle

If agents cannot securely access Gmail/Auth0 and persist pipeline state, the product does not exist.
UI work is downstream of plumbing reliability.

## Locked Stack Decisions (2026-04-01)

- [x] UI component system (later dashboard + theming): shadcn/ui preset b1VlJlhY (Luma).
- [/] M1 chat surface: replace Assistant0 UI with Vercel AI SDK UI (`useChat`) for streaming, tool-calling UX, stop controls, and persistence hooks.
- [x] MCP server implementation framework: FastMCP.

## Full Flow Definition (MVP)

The MVP is "real" only when all of this works in sequence:

1. New inbound email can be fetched using Auth0 Token Vault (Google connection).
2. Email text can be manually triaged from existing chat tool-calling surface.
3. Candidate profile can be generated as structured data.
4. Candidate row can be written to DB and read back.
5. Founder/hiring_manager permissions are enforced through FGA checks for sensitive transitions.
6. Final scheduling flow sends live Cal slot options (3 options max, one per day), parses candidate reply, and books in Cal.
7. Cal-managed bookings avoid duplicate founder confirmation email (Cal invite is source of truth).
8. Scheduling reply candidate resolution prefers identity keys (thread match first, email fallback) and escalates ambiguous matches to manual review.
9. Transcript summary is generated from Cal booking transcripts, with Drive PDF fallback when needed.
10. Offer send path is gated by CIBA when initiated by hiring_manager.
11. MCP tools can query pipeline with Auth0 JWT + FGA filtering.

Anything not supporting this chain is secondary.

## Validated Flow Chain (2026-04-05)

- [x] Request send (`scheduling.request.send`) delivers live Cal slot options.
- [x] Reply parse + book (`scheduling.reply.parse_book`) creates Cal booking and sets `interview_scheduled`.
- [x] Auto follow-up draft (`offer.draft.create`) triggers after successful booking when `autoSubmitOffer=true`.
- [x] Auto clearance submit (`offer.submit.clearance`) enqueues CIBA and persists awaiting-clearance state.
- [/] Clearance poll completion (`offer.clearance.poll`) transitions to sent-after-clearance once live approval occurs in-window.

Recent validated run ids from flow context:

- `scheduling.request.send`: `a79d8181d1f6464b830ac12fccddc1de`
- `scheduling.reply.parse_book`: `c08c77d3b6ac4bfaa9bb05a0f137f678`
- `offer.draft.create`: `45806057f3bc48d1a612aa1ec3101a18`
- `offer.submit.clearance`: `68bffce24cb249f79a6e07d0f248b4c4`
- stale draft dead-letter validation: `e4d3bf7af9f542b9aae7e4c0f3f70e89`

## Current Reality Snapshot

### Already Present In Repo

- [x] Auth0 session + middleware protection.
- [x] Token Vault wrappers for Google, Slack, GitHub in src/lib/auth0-ai.ts.
- [x] Existing chat tool-calling surface in src/app/api/chat/route.ts.
- [x] Existing Assistant0 chat UI is functional and can be swapped without changing core tool logic.
- [x] Gmail tools already wired (search + draft) in src/lib/tools/gmail.ts.
- [x] Calendar read tool exists in src/lib/tools/google-calender.ts.
- [x] Cal scheduling toolchain exists in src/lib/tools/scheduling.ts and src/lib/tools/cal-scheduling.ts.
- [x] Slack channels tool exists in src/lib/tools/list-slack-channels.ts.
- [x] Transcript summarization tools exist in src/lib/tools/interview-transcripts.ts (Cal-first + Drive fallback).
- [x] Drizzle database wiring + migrations in src/lib/db.
- [x] Candidate identity graph table exists (`candidate_identity_keys`) with ingest + scheduling-reply upserts.
- [x] Existing write path to DB + embeddings in src/lib/actions/documents.ts.
- [x] FGA bootstrap + basic doc model in src/lib/fga.

### Missing For Headhunt Spec

- [x] Jobs/Candidates/Applications/Interviews/Templates/Offers/Audit schema.
- [/] Agent-specific API and edge handlers (intercept/triage/analyst/liaison/dispatch) are present but still being normalized under one runbook.
- [x] CIBA initiate/poll implementation for clearance queue.
- [/] FGA model evolution from doc-level to org/job/candidate relations.
- [/] FastMCP server scaffold + MCP transport + tool handlers.
- [ ] No-chat Ops Board experience.

## MCP Grounding Log (Required Before Architectural Decisions)

Rule: every architecture decision references one of Auth0 Docs MCP, Supabase MCP, or Shadcn MCP before implementation.

### Auth0 Docs MCP Notes

- [x] Token Vault baseline docs confirmed.
	- Source: https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault
	- Decision: keep all third-party tokens in Token Vault and request minimal scopes per tool execution.

- [x] Calling external IdP API references confirmed.
	- Source: https://auth0.com/docs/authenticate/identity-providers/calling-an-external-idp-api
	- Source: https://auth0.com/docs/authenticate/identity-providers/adding-scopes-for-an-external-idp
	- Decision: ensure M2M token used for token retrieval has read:user_idp_tokens equivalent capability where applicable.

- [x] CIBA flow references confirmed.
	- Source: https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-initiated-backchannel-authentication-flow/user-authorization-with-ciba
	- Decision: implement bc-authorize initiation and oauth/token poll loop with explicit handling for pending/denied/approved outcomes.

- [x] RAR references confirmed.
	- Source: https://auth0.com/docs/get-started/apis/configure-rich-authorization-requests
	- Decision: carry authorization_details on high-risk actions for audit traceability.

### Supabase MCP Notes

- [x] RLS hard requirement confirmed.
	- Source: https://supabase.com/docs/guides/api/securing-your-api
	- Decision: all public schema tables must have RLS enabled before exposing any pipeline read/write API.

- [x] service_role handling constraints confirmed.
	- Source: https://supabase.com/docs/guides/api/api-keys
	- Decision: service_role usage is server-only; never client-exposed; use publishable key for browser clients.

- [x] Cron + pg_net scheduling patterns confirmed.
	- Source: https://supabase.com/docs/guides/cron/quickstart
	- Source: https://supabase.com/docs/guides/functions/schedule-functions
	- Decision: keep polling path as MVP baseline and move to push/webhook for v2.

### Shadcn MCP Notes

- [x] Registry availability confirmed for dashboard primitives.
	- Registry: @shadcn
	- Candidate components: card, badge, tabs, table, chart, calendar, dialog, sheet, sidebar.
	- Add command prepared:
		- npx shadcn@latest add @shadcn/card @shadcn/badge @shadcn/tabs @shadcn/table @shadcn/chart @shadcn/calendar @shadcn/dialog @shadcn/sheet @shadcn/sidebar

- [x] Preset decision locked: b1VlJlhY (Luma).
	- Planned init/migration command:
		- npx shadcn@latest init --preset b1VlJlhY

## Phase Plan

---

## M1 - Connections (Auth0 Token Vault + Supabase Write Path)

Goal: prove we can pull Gmail on behalf of user and persist a candidate-like record reliably.
Exit criteria: deterministic E2E smoke from authenticated request -> tokenized provider call -> DB write -> DB read.

### M1.0 Baseline and Environment

- [x] Confirm local DB + migrations run without failure.
	- Evidence: drizzle push executed successfully.
- [x] Confirm FGA init script runs.
	- Evidence: npm run fga:init successful.
- [x] Add explicit .env checklist section for Headhunt-specific vars (Auth0/FGA/Supabase/CIBA/MCP).
	- Evidence: .env.example now includes Token Vault connection/scope overrides used by diagnostics.

### M1.0A Chat UI Swap (Assistant0 -> Vercel AI SDK UI)

- [x] Replace current Assistant0 chat frontend with AI SDK UI (`useChat`) as the M1 operator console.
- [x] Keep server endpoint compatibility with current tool-calling backend (`/api/chat`) during transition.
- [x] Implement core M1 UX controls via AI SDK UI:
	- [x] streaming message rendering
	- [x] tool call / tool result rendering
	- [x] stop generation
	- [x] retry/regenerate
	- [x] optimistic input/submit states
- [x] Add message persistence adapter for thread continuity (phase-appropriate persistence).
- [x] Ensure TokenVaultInterruptHandler still works in the new chat surface.

Acceptance checks:

- [x] Conversation streams incrementally end-to-end.
- [x] Tool call outputs are visible and understandable in-chat.
- [x] Stop generation works reliably.
- [/] Refresh/resume restores thread messages for active session.

### M1.1 Token Vault Verification First

- [x] Existing Gmail read/write tool wrappers are present.
- [x] Existing calendar/slack wrappers are present.
- [/] Add dedicated connection-check endpoints (or chat tools) for:
	- [x] verify_gmail_read_connection
	- [x] verify_gmail_send_connection
	- [x] verify_calendar_connection
	- [x] verify_slack_connection
- [x] Add consistent TokenVaultError -> actionable UI interrupt payload mapping.
- [x] Add one-click smoke prompt in chat UI for "run_connection_diagnostics".
- [x] Scope chat thread and persisted message state by authenticated user identity.
- [x] Force login/signup account chooser and federated logout to reduce sticky-idp session reuse.

Acceptance checks:

- [x] Authenticated user can trigger Gmail profile/read check without manual token handling.
- [x] Missing consent path triggers interrupt UX and succeeds after user consent.
- [x] Failures produce normalized error JSON (no raw stack leaks).

### M1.2 Supabase/DB Foundation For Hiring Domain


- [x] Create first migration for core entities:
	- [x] organizations
	- [x] jobs
	- [x] candidates
	- [x] applications
	- [x] interviews
	- [x] templates
	- [x] offers
	- [x] audit_logs

- [x] Create Drizzle schema files for each entity.
- [x] Add enums for stage/status where useful.
- [x] Add indexes for frequent access paths:
	- [x] candidates(job_id, stage)
	- [x] offers(status)
	- [x] audit_logs(resource_type, resource_id, timestamp)

- [x] Add Zod schemas for insert/update DTOs.
- [x] Add deterministic demo seed script for stage-matrix data (jobs/candidates/applications/interviews/templates/offers/audit logs).

Acceptance checks:

- [x] db:generate + db:push works cleanly.
- [x] Minimal seed inserts organization/job/candidate rows.
- [x] Query returns expected counts by stage.
- [x] Demo seed command can recreate applied->hired pipeline states with stable IDs.

### M1.3 First Valuable Write (Candidate Ingest Lite)

- [x] Implement temporary server action or API route: create_candidate_from_email.
- [x] Inputs:
	- [x] jobId
	- [x] candidate name/email
	- [x] raw email text
	- [x] source metadata (message/thread ids)
- [x] Persist candidate + application row + audit event.
- [x] Return canonical payload used later by Intel Card.

Acceptance checks:

- [ ] Single request creates row set atomically.
- [ ] Duplicate source message id is idempotent.
- [ ] Audit record includes actor, action, result.

### M1.4 RLS/Server-Key Boundaries

- [x] Enable RLS on new public tables.
- [x] Add restrictive base policies (authenticated only + org scoped).
- [x] Keep all service-role operations server-side only.
- [x] Add "security smoke" SQL checks in tracker runbook.

Exit gate for M1:

- [/] "fetch Gmail + create candidate" works from authenticated session with no manual credentials.

---

## M2 - Logic (Tool-First Agent Actions via AI SDK UI Admin Console)

Goal: use AI SDK UI chat as operator console to run agent actions manually before no-chat frontend exists.
Exit criteria: Headhunt core actions callable as tools with structured outputs and persisted side effects.

### M2.0 Orchestrator Scope


- [/] Define tool contracts in code for first wave actions:
	- [x] run_intercept
	- [x] run_intake_e2e
	- [x] run_triage
	- [x] generate_intel_card
	- [x] schedule_interview_slots
	- [x] draft_offer_letter
	- [x] submit_offer_for_clearance

- [/] Each tool must enforce:
	- [/] input validation (zod)
	- [/] FGA check before writes
	- [/] audit logging
	- [/] normalized result schema

### M2.1 Intercept + Triage

- [x] Build intercept route/tool to pull candidate-like emails from Gmail.
- [x] Build triage classifier output schema:
	- [x] classification (application/scheduling_reply/inquiry/irrelevant)
	- [x] jobId (nullable)
	- [x] confidence
- [x] Persist triage decision + route decision.

Acceptance checks:

- [x] Manual run on test inbox returns deterministic structured output.
- [x] scheduling_reply is routed without candidate creation.
- [x] irrelevant messages are logged and ignored.

### M2.2 Analyst (Intel Card Generation)

- [x] Implement generate_intel_card tool using structured output schema.
- [x] Parse resume text (PDF/plain/markdown) if available.
- [x] Save score, score breakdown, qualification checks, summary, work history.
- [x] Upsert candidate stage to reviewed.

Acceptance checks:

- [ ] Score output is always 0-100 with dimension breakdown.
- [ ] Missing data paths still produce valid object with low confidence flags.
- [ ] Output can be rendered without post-processing hacks.

### M2.3 Liaison (Scheduling Actions)

- [x] Tool: parse_candidate_availability
- [x] Tool: propose_interview_slots
- [x] Tool: confirm_interview_event
- [x] Tool: send_interview_confirmation
- [x] Tool: run_final_schedule_flow (Cal-slot-first request, candidate reply analysis, auto-book)
- [x] Persist interview record + candidate stage transitions.
- [x] Constrain candidate outreach to 3 slot options max, one per day.
- [x] Skip duplicate founder confirmation email for Cal-managed bookings.

Acceptance checks:

- [x] At least one end-to-end schedule flow creates Cal booking UID + persisted interview record.
- [x] First scheduling outreach email always uses live Cal free slots (not generic availability ask).
- [x] Founder can constrain outreach days (for example `days sat,sun`) while keeping auto day-pick defaults.
- [x] Candidate stage becomes interview_scheduled after booking persistence.
- [x] Candidate outreach uses natural-language email body (not raw slot dump formatting).
- [x] Cal-managed bookings do not send duplicate founder confirmation email.
- [ ] Slack summary hook can post test message.

### M2.7 Transcript Summary (Cal + Drive Fallback)

- [x] Tool: summarize_cal_booking_transcript (`/v2/bookings/{bookingUid}/transcripts`).
- [x] Tool: summarize_drive_transcript_pdf (Google Drive PDF fallback by file id/query).
- [x] Structured HR-style transcript rubric summary with recommendation + actionable follow-ups.
- [x] Persist summary to interview record and audit logs.
- [x] Wire tools into chat route and result summaries.

Acceptance checks:

- [ ] At least one live booking UID returns transcript URL(s) and extractable transcript text.
- [ ] Drive fallback path works with `drive.readonly` consented connection.
- [ ] Generated summary includes recommendation, rubric score, strengths, risks, and actionable follow-ups.

### M2.4 Dispatch (Offer + CIBA Hold)

- [x] Add offer term capture schema.
- [x] Add draft generation tool.
- [x] Add CIBA initiation service.
- [x] Add CIBA polling handler.
- [x] Enforce rule:
	- [x] founder can send directly
	- [x] hiring_manager requires CIBA approval

Acceptance checks:

- [x] Pending clearance state persists with expiry timestamp.
- [/] Deny path does not send offer.
- [/] Approve path sends offer and updates stage to offer_sent.

### M2.5 Chat Console UX For Operators

- [ ] Add standard command prompts for operators:
	- [ ] /run intake for job <id>
	- [ ] /score candidate <id>
	- [ ] /schedule candidate <id>
	- [ ] /draft-offer candidate <id>
- [ ] Add tool-result cards in chat output for readability.
- [ ] Add per-action elapsed time and result status.

### M2.6 MCP Server Build (FastMCP)

- [x] Scaffold `mcp-server/` using FastMCP.
- [x] Implement MVP tools in FastMCP handlers:
	- [x] list_jobs
	- [x] list_pipeline
	- [x] get_candidate_detail
	- [x] summarize_pipeline_health
- [x] Add Auth0 JWT verification at MCP boundary.
- [/] Add FGA checks inside each MCP tool before data return.
- [x] Expose transport endpoint for local and hosted usage.

Acceptance checks:

- [ ] Authenticated founder can call all four tools successfully.
- [ ] Unauthorized access attempts are rejected with clear errors.
- [ ] Returned payloads are stable and compatible with MCP clients.

Exit gate for M2:

- [/] Operator can run full manual pipeline in chat from intake to offer clearance.

---

## M3 - Dashboard (Shadcn No-Chat Ops Board)

Goal: move from operator chat commands to explicit no-chat control panels once backend is reliable.
Exit criteria: founders can execute critical actions without chat interface.

### M3.0 Foundation Layout

- [ ] Build dashboard shell (sidebar + header + auth-aware nav).
- [ ] Apply Luma preset design tokens (shadcn preset b1VlJlhY) across dashboard and later chat theming pass.
- [ ] Add pages:
	- [ ] / (dashboard)
	- [ ] /jobs
	- [ ] /jobs/[jobId]
	- [ ] /jobs/[jobId]/candidates/[candidateId]
	- [ ] /approvals
	- [ ] /audit

### M3.1 Pipeline Board

- [ ] Implement kanban columns for stages.
- [ ] Implement candidate card summary blocks.
- [ ] Implement stage move actions with FGA-aware controls.
- [ ] Add optimistic updates + rollback.

### M3.2 Candidate Intel Card

- [ ] Score gauge + breakdown sections.
- [ ] Qualification checklist.
- [ ] Work history timeline.
- [ ] Email thread snapshot.
- [ ] Audit timeline.

### M3.3 Clearance Queue

- [ ] Pending CIBA cards with countdown.
- [ ] View draft offer content.
- [ ] Approve/deny controls + live state.

### M3.4 Dashboard Component Plan (Shadcn MCP Aligned)

- [ ] card
- [ ] badge
- [ ] tabs
- [ ] table
- [ ] chart
- [ ] calendar
- [ ] dialog
- [ ] sheet
- [ ] sidebar

Exit gate for M3:

- [ ] Demo can be run fully from no-chat UI with same backend actions.

## Cross-Cutting Workstreams

### Security + Authorization

- [/] Evolve FGA model from doc-level to org/job/candidate roles.
- [x] Add centralized check helper for role-relation-object tuples.
- [ ] Add negative tests for forbidden actions.
- [ ] Add redaction policy for candidate PII in low-privilege contexts.

### Auditability

- [/] Write audit event on every agent and user action.
- [/] Include cibaAuthReqId and approval actor where applicable.
- [/] Build query helpers for candidate-centric timelines.

### Reliability + Observability

- [/] Add per-tool structured logs with request id.
- [/] Add retry policy for transient Gmail/Google API errors.
- [x] Add dead-letter handling for terminal automation failures.

### Test Strategy

- [ ] Unit tests for schema validation and policy checks.
- [ ] Integration tests for critical route chains.
- [/] Smoke scripts for demo paths.
	- [x] Deterministic DB seed script exists (`npm run seed:demo`).
	- [x] Chat-log smoke checker exists for `HHLOG_JSON` exports (`npm run smoke:chat-log`).
	- [x] Add authenticated endpoint replay script for fixture emails (`npm run smoke:ingest-endpoint`).
	- [x] Boundary guard smoke exists for missing-context/manual-review assertions (`npm run smoke:boundary-guards`).
	- [x] Edge E2E smoke chain exists for schedule -> draft -> clearance handoff (`npm run smoke:edge-e2e`).

### Demo Seed Strategy

- [x] Create deterministic demo seed script (`scripts/seed-demo-headhunt.ts`).
- [x] Create playbook for scopes, fixtures, and inject runbook (`product/headhunt-demo-seed-playbook.md`).
- [x] Add one-command fixture replay path for authenticated Gmail intake (`run_intake_e2e`).

## Verify-First Checklist (Use Before Building Any Feature)

For any feature PR, complete this checklist first:

- [ ] Auth state verified (valid session).
- [ ] Required provider connection consent exists (or explicit interrupt path tested).
- [ ] Required DB migration applied locally.
- [ ] FGA relation needed by feature is defined.
- [ ] Tool input/output schema written before route logic.

## Command Runbook

### Daily Bootstrap

- [ ] npm install
- [ ] docker compose up -d
- [ ] npm run db:push
- [ ] npm run fga:init
- [ ] npm run dev

### Connection Smoke

- [ ] Trigger Gmail read tool from chat and confirm non-empty output.
- [ ] Trigger calendar read tool and confirm structured events.
- [ ] Trigger slack channel list tool and confirm channel names.

### Data Smoke

- [x] Run deterministic seed: `npm run seed:demo -- --reset`.
- [x] Confirm stage matrix includes applied/reviewed/interview_scheduled/interviewed/offer_sent/hired/rejected.
- [x] Run chat-log smoke checker: `npm run smoke:chat-log -- --file /tmp/hhlog.txt --require-scheduling --verbose`.
- [x] Run boundary guard smoke checker: `npm run smoke:boundary-guards`.
- [ ] Run authenticated endpoint replay: `HEADHUNT_SMOKE_COOKIE='...' npm run smoke:ingest-endpoint -- --fixture all --verbose`.
- [ ] Run one-command intake replay in chat: `run_intake_e2e` and confirm processed message summary.
- [ ] Create candidate ingest payload via route/tool.
- [ ] Verify candidate row + audit row written.
- [ ] Verify stage query for job returns expected counts.

### RLS Security Smoke

- [ ] Run migrations on a migration-tracked DB: `npm run db:migrate`.
- [ ] If local DB was bootstrapped with `db:push` and migration history is missing, apply only the RLS migration file directly:
	- `node -e "const fs=require('fs'); require('dotenv').config({path:'.env.local'}); const postgres=require('postgres'); const sql=postgres(process.env.DATABASE_URL,{max:1}); (async()=>{await sql.unsafe(fs.readFileSync('src/lib/db/migrations/0003_wise_selene.sql','utf8')); await sql.end(); console.log('ok');})().catch(async e=>{console.error(e); try{await sql.end();}catch{} process.exit(1);});"`
- [ ] Set authenticated org claims in SQL session:
	- `select set_config('request.jwt.claims', '{"role":"authenticated","org_id":"org_smoke"}', true);`
- [ ] Confirm org-scoped reads allow same-org rows:
	- `select count(*) from jobs where organization_id = 'org_smoke';`
- [ ] Confirm cross-org rows are blocked by RLS:
	- `select count(*) from jobs where organization_id = 'org_other';` (expected `0`)
- [ ] Confirm unauthenticated requests are blocked:
	- `select set_config('request.jwt.claims', '{"role":"anon"}', true);`
	- `select count(*) from jobs;` (expected `0`)
- [ ] Confirm application access is scoped through job organization:
	- `select count(*) from applications;` with org claims should only return applications linked to that org's jobs.

### Clearance Smoke

- [x] Create offer draft as hiring_manager.
- [x] Confirm CIBA request enters awaiting_clearance.
- [/] Simulate approval path and verify offer sent transition.

## Risks and Mitigations

- [ ] Risk: Token scope mismatch at runtime.
	- Mitigation: always request minimal operation-specific scopes and expose meaningful consent prompts.

- [ ] Risk: Incomplete RLS before API exposure.
	- Mitigation: no public data routes merged without RLS enabled and reviewed.

- [ ] Risk: CIBA race/poll timeouts.
	- Mitigation: explicit pending/expired/denied states with retries and user-visible timers.

- [ ] Risk: Scope creep into dashboard polish.
	- Mitigation: enforce M1/M2 exit gates before any large UI epics.

## Immediate Next 72 Hours

### Day 1 (Reliability Closure)

- [ ] Complete a clean live approval run for `offer.clearance.poll` in-window and capture evidence.
- [ ] Add explicit smoke assertions for CIBA denied/expired paths.
- [ ] Lock runbook defaults for `sendMode` safety in non-production validations.

### Day 2 (Acceptance Closure)

- [ ] Run end-to-end intake -> schedule -> transcript -> clearance chain from a reset candidate state.
- [ ] Capture acceptance artifacts in `product/smoke-*.json` with linked run ids.
- [ ] Finalize hackathon demo script against current operator flow.

### Day 3 (Handoff + Product Truth)

- [ ] Freeze and publish "current-state" docs for spec, tracker, and flow context.
- [ ] Define M3 no-chat UI API contracts from current tool outputs.
- [ ] Add explicit MCP acceptance run and FGA denial proof artifacts.

## Definition of Done For Hackathon Demo

- [x] M1 operator chat runs on AI SDK UI (`useChat`) with tool output visibility + stop control.
- [/] Intake can process at least 3 realistic applications from Gmail.
- [/] At least 1 candidate goes end-to-end: reviewed -> interview_scheduled -> interviewed -> offer_sent.
- [/] At least 1 completed interview has transcript summary generated (Cal-first or Drive fallback).
- [x] Hiring manager initiated offer requires founder CIBA approval.
- [/] FastMCP endpoint can answer list_jobs + list_pipeline + candidate detail for authorized user.
- [/] Audit timeline clearly shows agent and human actions.

## Out of Scope Until Core Flow Is Green

- [ ] Fancy visual polish not tied to state clarity.
- [ ] Full Gmail Pub/Sub production hardening.
- [ ] Bulk operations and advanced analytics.
- [ ] Additional outbound channels beyond required demo paths.

