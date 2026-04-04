# Headhunt Demo Seed Playbook

Last updated: 2026-04-04
Owner: Lead Founding Engineer

## Goal

Create deterministic mock data and fixture emails so demos can run reliably without waiting on live inbox variability.

This playbook is built against current implementation in:
- `scripts/seed-demo-headhunt.ts`
- `src/app/api/candidates/ingest/route.ts`
- `src/lib/tools/intake-e2e.ts`
- `src/lib/tools/triage-intel.ts`
- `src/lib/tools/connection-diagnostics.ts`
- `src/lib/tools/scheduling.ts`
- `src/lib/tools/interview-transcripts.ts`
- `src/lib/prompts/resume-synthesis.ts`

## Quick Start (Local)

1. Start dependencies and migrate DB.

```bash
npm install
docker compose up -d
npm run db:migrate
npm run fga:init
```

2. Seed deterministic demo records.

```bash
npm run seed:demo -- --reset
```

3. Start app.

```bash
npm run dev
```

4. Run connection checks in chat.

Use:
- `run_connection_diagnostics`
- If needed: `authorize_connections_step:google`
- If needed: `authorize_connections_step:slack`

## What Gets Seeded

The seed script injects one deterministic organization and a full candidate stage matrix.

- Organization: `org_demo_headhunt`
- Jobs:
  - `job_demo_founding_engineer`
  - `job_demo_product_designer`
- Candidate stages covered:
  - `applied`
  - `reviewed`
  - `interview_scheduled`
  - `interviewed`
  - `offer_sent`
  - `hired`
  - `rejected`
- Also seeded:
  - `applications`
  - `interviews`
  - `templates`
  - `offers` (including `awaiting_approval` and `sent` states)
  - `audit_logs`

## Required Connections And Scopes

Source of truth is `src/lib/auth0-ai.ts` and diagnostics tools.

### Google Token Vault connection

- Connection env key: `AUTH0_GOOGLE_CONNECTION`
- Default connection: `google-oauth2`
- Required scopes (union used by current tools):
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.compose`
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/drive.readonly` (required for transcript PDF fallback)

### Cal.com Token Vault connection

- Connection env key: `AUTH0_CAL_CONNECTION`
- Default connection: `cal-connection`
- Required scopes (current default set in app):
  - `PROFILE_READ`
  - `SCHEDULE_READ`
  - `SCHEDULE_WRITE`
  - `BOOKING_READ`
  - `BOOKING_WRITE`
  - `EVENT_TYPE_READ`
  - `EVENT_TYPE_WRITE`

### Slack Token Vault connection

- Connection env key: `AUTH0_SLACK_CONNECTION`
- Default connection: `sign-in-with-slack`
- Required scopes (default):
  - `channels:read`
- Optional for private channels:
  - `groups:read`

### My Account API scope (for deterministic diagnostics)

`run_connection_diagnostics` uses Auth0 My Account connected accounts metadata.

Required scope:
- `read:me:connected_accounts`

## Fixture Emails (Copy/Paste)

Use these for triage/intel demos. They are intentionally short and deterministic.

### Fixture A - application (should route to analyst)

Subject: `Application - Founding Engineer - Maya Patel`

Body:

```text
Hi team,

I am applying for the Founding Engineer role. I have 4 years of backend experience in TypeScript and distributed systems, and I have shipped recruiting workflow tooling for startup teams.

Resume highlights:
- Built queue-based orchestration services on AWS
- Led reliability work that reduced incident volume by 35%
- Mentored 3 junior engineers

Thanks,
Maya Patel
```

Expected triage:
- `classification: application`
- `route: analyst`
- `jobId: job_demo_founding_engineer` (if known jobs are provided)

### Fixture B - scheduling reply (should route to liaison)

Subject: `Re: Interview availability - Julian Kim`

Body:

```text
Thanks for the invite. I can do Tuesday 2-5 PM PT or Wednesday 10 AM-1 PM PT.
Please send a Google Meet invite to this email.
```

Expected triage:
- `classification: scheduling_reply`
- `route: liaison`

### Fixture C - irrelevant

Subject: `Invoice reminder`

Body:

```text
Please review your monthly SaaS invoice. Payment is due in 3 days.
```

Expected triage:
- `classification: irrelevant`
- `route: none`

## Injection Paths

### Path 1 - DB-level deterministic seed (recommended baseline)

Use when you want instant stage coverage and stable IDs.

```bash
npm run seed:demo -- --reset
```

### Path 2 - One-command true E2E intake run (recommended live run)

Tool: `run_intake_e2e`

What it does in one pass:
- pulls candidate-like emails from your Gmail (`run_intercept` logic)
- triages each message (`run_triage` logic)
- ingests into DB (`/api/candidates/ingest` shared transaction logic)
- optionally generates intel and moves stage to `reviewed` (`generate_intel_card` logic)

Suggested chat prompt:

```text
run_intake_e2e with query "in:inbox newer_than:3d" and processLimit 3 and generateIntel true for organizationId org_demo_headhunt
```

If you already sent yourself test applications, this is your "one true end-to-end run" command.

Troubleshooting:
- If you previously saw `No object generated: response did not match schema`, rerun with the latest code.
- `run_triage` now falls back to heuristic classification when structured generation fails.
- `run_intake_e2e` now skips non-application messages instead of ingesting them.

Scheduling troubleshooting:
- If `schedule_interview_slots` loops on generic authorization prompts, use the latest code and rerun once.
- If candidate is seeded but not yours, you may see `Forbidden: no candidate visibility access`; use the candidate id created by your own `run_intake_e2e` run.
- If Calendar scopes are missing, the tool now returns an explicit message to run `run_connection_diagnostics` and then `authorize_connections_step:google`.
- If selectedStartISO is stale, the tool now returns fresh slots in the same response (`mode: propose`) with `recovery.reason: stale_selected_start_iso`; you only need to confirm one of the returned selectedStartISO values.
- For Cal-managed bookings, do not send duplicate founder confirmation email; Cal invite email is treated as source-of-truth.

Final scheduling flow (Cal free slots -> candidate confirmation -> Cal booking):
- Use one command for both stages:

```text
/schedule candidate <candidate_id> job <job_id> eventTypeSlug 30min username <cal_username> action auto sendMode send days sat,sun timezone America/Los_Angeles
```

- First run behavior:
  - Calls Cal `/v2/slots` for your live free slots (`eventTypeSlug` + `username/teamSlug`).
  - Picks candidate-facing slot options from the selected day set (for example `days sat,sun`) and sends **3 options max (1 per day)** on the original application thread in natural-language format.
- Candidate replies on the same thread with option number(s) or alternate windows.
- Second run behavior (same command):
  - Analyzes candidate reply from Gmail.
  - Re-checks live Cal availability.
  - Uses candidate-selected option when available; otherwise intersects candidate windows with current Cal slots.
  - Auto-picks earliest overlap and creates a 30-minute Cal booking.
  - Cal sends booking notification email; platform skips duplicate founder confirmation for Cal-managed bookings.

Optional explicit stages:
- Request only:

```text
/schedule candidate <candidate_id> job <job_id> eventTypeSlug 30min username <cal_username> action request_candidate_windows sendMode send days sat,sun timezone America/Los_Angeles
```

- Book only (after reply exists):

```text
/schedule candidate <candidate_id> job <job_id> eventTypeSlug 30min username <cal_username> action book_from_reply timezone America/Los_Angeles
```

Transcript summary flow (Cal-first, Drive fallback):

- Preferred path (Cal transcript endpoint):

```text
summarize_cal_booking_transcript with bookingUid <booking_uid> candidateId <candidate_id> jobId <job_id>
```

- Fallback path (Drive PDF transcript by file id or search query):

```text
summarize_drive_transcript_pdf with driveQuery "<candidate name or meeting transcript title>" candidateId <candidate_id> jobId <job_id>
```

Or:

```text
summarize_drive_transcript_pdf with driveFileId <drive_file_id> candidateId <candidate_id> jobId <job_id>
```

Post-transcript decision flow (demo-phase):
1. Review recommendation + rubric + risks + actionable follow-ups.
2. Decide branch:
  - move forward to next round,
  - draft offer,
  - hold for additional signal,
  - reject.
3. Record decision in audit trail and update candidate stage in operator workflow.
4. If moving to offer, run `draft_offer_letter` and continue with approval flow.

Offer drafting tool:
- Call `draft_offer_letter` with `candidateId`, `jobId`, and `terms` (`baseSalary`, `currency`, `startDate`, optional `equityPercent`, `signOnBonus`, `bonusTargetPercent`, `notes`).
- The tool persists/updates an offer row in `draft` status and records an audit log event.

Chat log smoke check (automated):
- Copy logs from chat using `Copy Logs` (Latest You + AI Exchange or Full Session).
- Save to a file, then run:

```bash
npm run smoke:chat-log -- --file /tmp/hhlog.txt --require-scheduling --verbose
```

- Or run directly from clipboard:

```bash
pbpaste | npm run smoke:chat-log -- --require-scheduling --verbose
```

- The command fails with exit code 1 when it detects stale/conflict schedule errors, raw tool marker leakage, or stub assistant text.

### Path 3 - API-level ingest (single message replay)

Endpoint: `POST /api/candidates/ingest`

Notes:
- Requires authenticated app session (Auth0 cookie).
- Route is idempotent by `source.gmailMessageId`.

Authenticated replay smoke command:

```bash
HEADHUNT_SMOKE_COOKIE='appSession=...; appSession.0=...'
npm run smoke:ingest-endpoint -- --fixture all --verbose
```

Command behavior:
- Replays fixture emails against `/api/candidates/ingest` as authenticated requests.
- Asserts first request creates candidate/application (`idempotent: false`).
- Replays the exact same payload and asserts idempotency (`idempotent: true`).

Useful options:
- `--base-url http://localhost:3000`
- `--organization-id org_demo_headhunt`
- `--job-id job_demo_founding_engineer`
- `--fixture application|scheduling_reply|irrelevant|all`
- `--no-idempotency-check`

Example payload:

```json
{
  "jobId": "job_demo_founding_engineer",
  "organizationId": "org_demo_headhunt",
  "candidateName": "Maya Patel",
  "candidateEmail": "maya.patel.demo+ingest@example.com",
  "rawEmailText": "I am applying for Founding Engineer. 4 years backend systems experience.",
  "source": {
    "gmailMessageId": "msg_demo_manual_ingest_001",
    "gmailThreadId": "thread_demo_manual_ingest_001",
    "receivedAt": "2026-04-02T12:00:00.000Z"
  }
}
```

## Operator Prompt Sequence (for you and Copilot)

After seeding:

1. `run_connection_diagnostics`
2. `run_intake_e2e` for one true end-to-end run using your Gmail inbox
3. `run_triage` with Fixture A or B (optional targeted validation)
4. `generate_intel_card` for a seeded candidate id and job id (optional targeted validation)
5. `run_final_schedule_flow` request + booking stages for a live candidate thread
6. `summarize_cal_booking_transcript` (or `summarize_drive_transcript_pdf` fallback)
7. Verify DB stage transitions and audit logs

Suggested candidate/job pair for intel generation:
- candidateId: `cand_demo_maya`
- jobId: `job_demo_founding_engineer`

## Demo Storyboard (Fast Run)

1. Run `npm run seed:demo -- --reset`.
2. Show dashboard/chat with populated pipeline across all stages.
3. Run `run_connection_diagnostics` and show healthy/missing scope output.
4. Send yourself 1-3 test application emails (Fixture A shape).
5. Run `run_intake_e2e` and show intercept -> triage -> ingest -> intel outputs.
6. Run scheduling flow to book via Cal and show booking link/invite behavior.
7. Run transcript summary tool (Cal first; Drive fallback if needed) and show recommendation/rubric output.
8. Show seeded `offer_demo_priya_awaiting` to explain CIBA hold state.
9. Show audit trail entries for ingest, triage, intel, scheduling, transcript summary, and offer hold.

## Known Gaps

- FGA model in repo is still doc-level and not yet expanded to org/job/candidate tuples from spec.
- End-to-end intake run still requires an authenticated browser session (Token Vault refresh token is session-bound).
