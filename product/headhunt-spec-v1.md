# Headhunt — Product Specification v1.0

### Auth0 "Authorized to Act" Hackathon · Engineering Blueprint (Demo-Phase)

> **Stack:** Next.js 15 · Vercel AI SDK · Supabase · Auth0 (Token Vault · FGA · CIBA · MCP)
> **Status:** Demo Phase (operator-assisted) · Deadline Apr 6 2026

---

## 1. Product Vision

### Elevator Pitch

Agents handle the pipeline. You approve the hire.

Headhunt is currently a demo-phase recruiting copilot for founders and early-stage startup teams. Applications that land in Gmail can be triaged, scored, and moved through interview scheduling with operator-triggered commands. Interview slots are sourced from live Cal availability, booking is performed in Cal, and high-stakes actions (like offer release) remain explicitly gated. The long-term autonomous behavior remains the target architecture, but this document reflects what is implemented for the demo now.

Founders post the job. Six agents run the search. You rule on who gets in.

### Why This Wins the Hackathon

Most entries show an AI agent doing things. Headhunt shows one **stopping** — a push notification on the founder's phone before any irreversible action ships. That 10-second pause is Auth0's entire security model made visceral in a 3-minute video. Every judging criterion is a feature, not a footnote.

| Criterion               | How Headhunt Wins It                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security Model**      | CIBA gates on 3 high-stakes moments; Token Vault holds every OAuth token; no agent ever sees a raw credential; RAR scopes each token to a single job context   |
| **User Control**        | Founders see exactly what each agent is authorized to touch; FGA tuples surface as a human-readable Clearance Panel; every action logged in Field Log          |
| **Technical Execution** | Token Vault + FGA + CIBA deployed non-trivially; real Gmail Pub/Sub pipeline; six-agent crew on Vercel AI SDK                                                  |
| **Design**              | Zero chat UI: Ops Board kanban, AI-rendered calendar slot picker, Field Log timeline — decisions surface as cards, not conversations                           |
| **Insight Value**       | A novel Auth0 pattern: CIBA as a delegation escalation gate — a hiring manager can draft, only a founder can fire. No existing documented example of this flow |

### Demo-Phase Scope Override (Apr 2026)

This spec is intentionally written for current demo operation, not full autonomous production behavior.

- Pipeline execution is operator-assisted from the AI SDK chat surface.
- Final scheduling is Cal-first and thread-aware:
  - request candidate windows with live Cal slots,
  - parse candidate reply,
  - re-check Cal,
  - create booking.
- Candidate outreach is constrained to **3 options total (1 slot per day)** and written in natural-language email format.
- For Cal-managed bookings, the system skips duplicate founder-sent confirmation emails to avoid double notifications.
- Transcript processing is currently tool-driven:
  - Cal transcripts via `/v2/bookings/{bookingUid}/transcripts`,
  - fallback to Google Drive PDF transcript parsing when Cal transcript text is unavailable.
- Final hiring decision after transcript summary is human-in-the-loop (advance, hold, reject, or draft offer).

---

## 2. User Persona & Problem

### Primary Persona — The Founding CEO / CTO

**Who they are:** Technical or non-technical founder, 2–30 person company, actively hiring for 2–5 roles simultaneously. May have a hiring manager or ops person helping, but all final decisions go through them.

**The pain:**

- Applications arrive in Gmail buried under investor emails, customer support, and newsletters. No separation, no triage.
- Each application means 20–45 minutes of manual reading, copy-pasting to a spreadsheet, LinkedIn research, and JD comparison.
- Scheduling a single interview takes 4–6 email exchanges over 2–3 days.
- Interview notes live in a Notion page nobody updates, a shared Google Doc, or nowhere.
- Offer letters are drafted from scratch each time from a stale Word template.
- The founder is the bottleneck at every stage — even though a hiring manager could handle most of it if the system enforced the right approvals.

**What they actually want:** Wake up to a ranked candidate list. Click Interview on the ones worth talking to. Watch a confirmation go out automatically. Receive an interview brief in Slack. Get a push when it's time to approve the offer. Done.

### Secondary Persona — The Hiring Manager

**Who they are:** An ops person, a senior IC deputised to run the search, or an early HR hire. Wants to own the process but doesn't have final authority on compensation or offer terms.

**The pain:** They're powerful enough to coordinate but not empowered to close. Every offer goes back to the founder through Slack. No formal approval workflow exists.

**What they want:** A system where they can drive candidates through stages autonomously — and the platform enforces the handoff to the founder at exactly the right moment, with no awkward messages required.

---

## 3. How It Works

### Run A — Founder (Decision Authority)

1. Posts a job on Headhunt: title, JD, requirements, compensation range.
2. Platform publishes to Tumblr automatically (CIBA confirmation first).
3. Runs intake from the operator console — **Intercept**, **Triage**, and **Analyst** classify and score candidates.
4. Reviews ranked candidates and marks each as Interview or Pass.
5. **Liaison** sends a Cal-slot-first outreach email (3 options, one per day) on the original application thread.
6. Candidate replies on-thread; **Liaison** analyzes reply and books via Cal.
7. Cal sends the booking notification directly; the platform avoids duplicate founder-sent confirmation for Cal-managed bookings.
8. Operator runs transcript summary (Cal first, Drive PDF fallback) and reviews recommendation + rubric.
9. Gets a CIBA push when an offer is ready. Reviews terms. Approves or kills from the phone.
10. **Dispatch** sends the offer letter the moment approval fires.

### Run B — Hiring Manager (Coordinator Role)

1. Full visibility into all jobs and pipelines assigned to them.
2. Can add notes, move candidates (except to Offer Sent), and book interviews independently.
3. Can draft an offer letter and submit for founder sign-off — which triggers **Dispatch** into CIBA-hold mode.
4. Cannot unilaterally send an offer. Enforced at the FGA layer, not just a disabled button.
5. Gets notified when the founder approves or kills the offer.

### Run C — Headhunt as a Business

1. Every completed hire validates that Headhunt cut time-to-offer by removing coordination overhead and manual scoring.
2. Field Log is exportable and becomes the source of truth for any hiring dispute.
3. Multi-role FGA expands naturally: add `recruiter`, `legal_reviewer`, `compensation_approver` as the team grows.
4. The MCP server creates distribution: founders who add Headhunt to Claude Desktop query their pipeline from wherever they already work. "What's my engineering search looking like?" becomes a daily habit that doesn't require opening a new tab.

---

## 4. Agent Architecture

### Overview

Headhunt runs a **one commander, five specialist agents** model. Each agent has a defined capability surface and a defined scope of tokens it can request from Token Vault. No agent ever sees a token not needed for its specific task.

```
                        ┌─────────────────────────────────┐
                        │             CONTROL             │
                        │  (Orchestrator · tool-calling)  │
                        └─────────────┬───────────────────┘
                                      │
          ┌─────────────┬─────────────┼─────────────┬─────────────┐
          │             │             │             │             │
    ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
    │ INTERCEPT │ │  TRIAGE   │ │  ANALYST  │ │  LIAISON  │ │ DISPATCH  │
    │           │ │           │ │           │ │           │ │           │
    │ Gmail     │ │ Routes    │ │ Parses +  │ │ Calendar· │ │ Letter gen│
    │ Pub/Sub   │ │ emails to │ │ scores vs │ │ Meet·Slack│ │ CIBA hold │
    │ watch     │ │ search    │ │ JD        │ │ ·Gmail    │ │           │
    └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘
```

### Agent Definitions

#### Commander — `Control`

- **Trigger:** Gmail Pub/Sub webhook (new email) OR user action on platform (click Interview / click Hire)
- **Responsibility:** Decides which agent to deploy based on context. Maintains pipeline state transitions. Checks FGA before any write action.
- **Token Vault access:** Requests tokens on behalf of field agents with minimum scopes needed.
- **Memory:** Reads job context and candidate context from Supabase before planning.

#### Field Agent 1 — `Intercept`

- **Trigger:** Gmail Pub/Sub webhook fires when a new email arrives in the connected inbox.
- **Capability:** Fetches the full email thread using a Gmail API token from Token Vault. Hands the email off to `Triage`.
- **Scope:** Gmail read-only token, scoped to the specific message ID received from the webhook.

#### Field Agent 2 — `Triage`

- **Input:** Raw email text + list of active jobs (job IDs + titles + keywords).
- **Output:** `{ jobId: string | null, classification: "application" | "scheduling_reply" | "inquiry" | "irrelevant", confidence: number }`
- **Model call:** Single `generateObject` call. Cheap, fast. Routes inbound signals to the right search.
- **If `classification === "scheduling_reply"`:** Routes to `Liaison` with full thread context.
- **If `classification === "application"`:** Routes to `Analyst`.

#### Field Agent 3 — `Analyst`

- **Input:** Raw email + any attachment text (resume PDF parsed server-side before agent call).
- **Output:** Structured `CandidateProfile` object (see Data Models).
- **Scoring:** Uses the job's `scoringCriteria` (extracted from JD at job creation) to produce a `score` (0–100) and `scoreBreakdown` with reasoning per dimension.
- **Output stored:** Written to `candidates` table in Supabase. Intel Card appears in pipeline immediately.
- **Model call:** One `generateObject` call with the full JD context in the system prompt.

#### Field Agent 4 — `Liaison`

- **Triggers:** (a) Founder/hiring_manager marks candidate Interview in the operator flow, (b) Email reply classified as scheduling-related by Triage.
- **Phase A — Cal Slot Outreach:** Calls Cal.com `/v2/slots` for the founder's configured event type and sends **3 candidate-facing options (1 slot per day)** on the original application thread.
- **Phase B — Reply Analysis + Recheck:** Parses candidate reply (option number or explicit window). Rechecks live Cal availability to avoid stale selections.
- **Phase C — Booking:** Creates Cal booking via `/v2/bookings` for the selected/overlapping slot and persists interview state (`interview_scheduled`).
- **Phase C.1 — Notification Behavior:** For Cal-managed bookings, Cal email is treated as source-of-truth invite; duplicate founder-sent confirmation is skipped.
- **Phase D — Transcript Summary (tool-driven in demo):**
  - Try Cal transcript endpoint: `/v2/bookings/{bookingUid}/transcripts`.
  - If transcript text is unavailable, fallback to Google Drive PDF transcript parsing.
  - Generate HR-style summary + rubric + actionable follow-ups and persist interview summary/audit logs.

#### Field Agent 5 — `Dispatch`

- **Trigger:** Founder or hiring manager clicks "Draft Offer" in the platform.
- **Step 1:** Reads offer playbook from `templates`. Prompts for any missing terms (role, compensation, start date, equity) via a structured form — not free-text chat.
- **Step 2:** Generates the full offer letter. Saves draft to `offers` table.
- **Step 3 (CIBA Hold):** If initiated by a `hiring_manager` role, triggers Auth0 CIBA to the `founder`. System enters `awaiting_clearance` state. UI shows a pending badge in the Clearance Queue.
- **Step 4:**

| Trigger                                | CIBA Message on Guardian                                                                         | Auth Level Required |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------- |
| Hiring manager submits offer draft     | "Dispatch is holding an offer for [Name] at [Role]. Salary: \$X. Review and confirm to release." | Founder MFA push    |
| Job post to Tumblr (any internal role) | "Headhunt wants to post [Role Title]. Confirm to publish."                                       | Founder MFA push    |
| Delete a candidate record (GDPR)       | "Headhunt wants to permanently erase [Name]'s data. This cannot be undone."                      | Founder MFA push    |

- **Step 4:** On founder approval (CIBA push confirmed), Dispatch sends the offer email via Gmail Token Vault token. Updates candidate `stage` to `offer_sent`.
- **Step 5:** Monitors Gmail for candidate reply. On acceptance, updates stage to `hired`. Fires a congratulatory Slack post to the hiring channel.

---

## 5. MCP Server Design

The MCP server exposes Headhunt's candidate pipeline to any MCP-compatible client (Claude Desktop, Claude.ai, ChatGPT with plugin support). A founder can ask "What's my current engineering pipeline?" from their Claude client and get a structured answer.

**Server location:** `mcp-server/index.ts`
**Auth:** Every MCP tool call validates the Auth0 JWT from the Authorization header before any data access. FGA check happens inside each tool before returning data.

### Tool Definitions

```typescript
// mcp-server/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkFGA } from "@/lib/fga";
import { supabase } from "@/lib/db/supabase";

const server = new McpServer({
  name: "headhunt",
  version: "1.0.0",
});

/**
 * Tool: list_pipeline
 * Returns candidate pipeline for a specific job or all jobs.
 * FGA: caller must have viewer access to the job.
 */
server.tool(
  "list_pipeline",
  "Surface every candidate in a search. Optionally filter by role or pipeline stage.",
  {
    jobId: z.string().optional().describe("Filter by specific job ID"),
    stage: z
      .enum([
        "applied",
        "reviewed",
        "interview_scheduled",
        "interviewed",
        "offer_sent",
        "hired",
        "rejected",
      ])
      .optional()
      .describe(
        "Filter by pipeline stage — applied, reviewed, interview_scheduled, interviewed, offer_sent, hired, rejected",
      ),
  },
  async ({ jobId, stage }, context) => {
    const userId = context.authInfo?.sub;
    if (!userId) throw new Error("Unauthenticated");

    // FGA: check viewer access
    if (jobId) {
      const allowed = await checkFGA(userId, "viewer", `job:${jobId}`);
      if (!allowed) throw new Error("Forbidden: insufficient FGA permissions");
    }

    const query: Record<string, string> = {};
    if (jobId) query.jobId = jobId;
    if (stage) query.stage = stage;

    const { data: candidates } = await supabase.from("candidates").select("*").match(query);
    if (!candidates) throw new Error("Failed to fetch candidates");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            candidates.map((c) => ({
              id: c.id,
              name: c.name,
              role: c.appliedJobTitle,
              stage: c.stage,
              score: c.score,
              summary: c.summary,
            })),
          ),
        },
      ],
    };
  },
);

/**
 * Tool: get_candidate_detail
 * Returns full Intel Card for a candidate.
 * FGA: viewer access for basic info; assessor access for score breakdown.
 */
server.tool(
  "get_candidate_detail",
  "Pull the full Intel Card for a candidate — score breakdown, interview notes, and work history.",
  { candidateId: z.string() },
  async ({ candidateId }, context) => {
    const userId = context.authInfo?.sub;
    const { data: candidate } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", candidateId)
      .single();
    if (!candidate) throw new Error("Candidate not found");

    const canView = await checkFGA(
      userId,
      "viewer",
      `candidate:${candidateId}`,
    );
    if (!canView) throw new Error("Forbidden");

    const canAssess = await checkFGA(
      userId,
      "assessor",
      `candidate:${candidateId}`,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...candidate,
            scoreBreakdown: canAssess
              ? candidate.scoreBreakdown
              : "Access restricted",
            contactEmail: canAssess ? candidate.contactEmail : "[redacted]",
          }),
        },
      ],
    };
  },
);

/**
 * Tool: list_jobs
 * Returns all active searches the caller can view.
 */
server.tool(
  "list_jobs",
  "List all active searches with pipeline stage counts. Ask: 'What roles am I running?' ",
  {},
  async (_, context) => {
    const userId = context.authInfo?.sub;
    const { data: jobs } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "active");
    
    if (!jobs) throw new Error("Failed to fetch jobs");

    // Filter to only jobs the caller can view via FGA
    const accessible = await Promise.all(
      jobs.map(async (job) => {
        const allowed = await checkFGA(userId, "viewer", `job:${job.id}`);
        return allowed ? job : null;
      }),
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            accessible.filter(Boolean).map((j) => ({
              id: j!.id,
              title: j!.title,
              status: j.status,
              candidateCount: j.candidateCount,
              openSince: j.createdAt,
            })),
          ),
        },
      ],
    };
  },
);

/**
 * Tool: summarize_pipeline_health
 * Returns a natural-language brief on a search's pipeline.
 * Useful for "How is my engineering search going?" queries.
 */
server.tool(
  "summarize_pipeline_health",
  "Get a natural language brief on pipeline health for a role. Ask: 'How is my engineering search going?'",
  { jobId: z.string() },
  async ({ jobId }, context) => {
    const userId = context.authInfo?.sub;
    const allowed = await checkFGA(userId, "viewer", `job:${jobId}`);
    if (!allowed) throw new Error("Forbidden");

    const { data: candidates } = await supabase
      .from("candidates")
      .select("*")
      .eq("jobId", jobId);
      
    if (!candidates) throw new Error("Failed to fetch candidates");

    const stages = candidates.reduce(
      (acc, c) => {
        acc[c.stage] = (acc[c.stage] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            jobId,
            stageCounts: stages,
            totalCandidates: candidates.length,
          }),
        },
      ],
    };
  },
);
```

### Token Validation Middleware

```typescript
// mcp-server/auth-middleware.ts
import { auth } from "express-oauth2-jwt-bearer";

export const validateMcpToken = auth({
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  audience: process.env.AUTH0_MCP_AUDIENCE, // separate audience for MCP
});
```

---

## 6. Auth0 Integration Map

### Social Connections (via Token Vault)

| Service         | Connection Name | Scopes Required                                | Token Vault Purpose                  |
| --------------- | --------------- | ---------------------------------------------- | ------------------------------------ |
| Gmail           | `google-oauth2` | `gmail.readonly`, `gmail.send`, `gmail.modify` | Email Monitor reads + sends emails   |
| Google Calendar | `google-oauth2` | `calendar.events`, `calendar.readonly`         | Interview Coordinator creates events |
| Slack           | `slack`         | `chat:write`, `channels:read`                  | Post interview summaries             |
| Tumblr          | `tumblr`        | `write`                                        | Auto-post job listings               |

> **Note:** Google Calendar and Gmail share the same `google-oauth2` connection in Auth0 but request separate scopes. Token Vault stores them under the same connection with the union of scopes. When an agent requests a token via Token Vault, it specifies the minimum scopes it needs for that operation.

### Token Vault Request Pattern

```typescript
// lib/token-vault.ts
import { ManagementClient } from "auth0";

const management = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_MGMT_CLIENT_ID!,
  clientSecret: process.env.AUTH0_MGMT_CLIENT_SECRET!,
});

export async function getVaultToken(
  userId: string,
  connection: "google-oauth2" | "slack" | "tumblr",
  requestedScopes: string[],
): Promise<string> {
  // Auth0 Token Vault endpoint
  const response = await fetch(
    `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${userId}/tokens/${connection}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await management.getClientCredentialsToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scopes: requestedScopes }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Token Vault error: ${response.status} ${await response.text()}`,
    );
  }

  const { access_token } = await response.json();
  return access_token;
}
```

### Rich Authorization Requests (RAR)

Every token request from an agent includes authorization_details for auditability. This is passed during the CIBA flow and logged:

```json
{
  "authorization_details": [
    {
      "type": "headhunt_action",
      "action": "send_interview_invitation",
      "job_id": "job_senior_eng_001",
      "candidate_id": "cand_abc123",
      "initiated_by": "user:hiring_manager_bob",
      "template_id": "tmpl_interview_outreach"
    }
  ]
}
```

---

## 7. FGA Access Control & Test Accounts

### FGA Model (OpenFGA DSL)

```dsl
model
  schema 1.1

type user

type organization
  relations
    define founder: [user]
    define hiring_manager: [user] or founder

type job
  relations
    define organization: [organization]
    define owner: [user] or organization#founder
    define manager: [user] or organization#hiring_manager or owner
    define viewer: [user] or manager

type candidate
  relations
    define job: [job]
    define viewer: job#viewer
    define assessor: job#manager
    define offer_authority: job#owner

type interview
  relations
    define candidate: [candidate]
    define interviewer: [user] or candidate#assessor
    define feedback_writer: interviewer

type template
  relations
    define organization: [organization]
    define editor: organization#founder or organization#hiring_manager
    define viewer: editor
```

### Role Capability Matrix

| Action                            | Founder         | Hiring Manager            | Interviewer                  |
| --------------------------------- | --------------- | ------------------------- | ---------------------------- |
| Create / edit job                 | ✅              | ✅                        | ❌                           |
| View all candidates               | ✅              | ✅ (assigned jobs)        | ✅ (assigned interview only) |
| View score breakdown              | ✅              | ✅                        | ❌                           |
| View candidate contact email      | ✅              | ✅                        | ❌                           |
| Move candidate to Interview stage | ✅              | ✅                        | ❌                           |
| Move candidate to Rejected        | ✅              | ✅                        | ❌                           |
| Draft offer letter                | ✅              | ✅ (then CIBA to founder) | ❌                           |
| **Send offer letter**             | **✅ (direct)** | **❌ (CIBA required)**    | **❌**                       |
| Submit interview feedback         | ✅              | ✅                        | ✅                           |
| Manage email templates            | ✅              | ✅                        | ❌                           |
| View audit logs                   | ✅              | ✅ (own actions)          | ❌                           |
| Access MCP server                 | ✅              | ✅ (restricted tools)     | ❌                           |

### FGA Tuple Examples

```json
[
  // Alice is the founder of org:acme
  {
    "user": "user:alice",
    "relation": "founder",
    "object": "organization:acme"
  },
  // Bob is a hiring manager at org:acme
  {
    "user": "user:bob",
    "relation": "hiring_manager",
    "object": "organization:acme"
  },
  // The Senior Engineer job belongs to org:acme
  {
    "user": "organization:acme",
    "relation": "organization",
    "object": "job:senior_eng_001"
  },
  // Charlie is assigned as interviewer for a specific interview
  {
    "user": "user:charlie",
    "relation": "interviewer",
    "object": "interview:interview_cand_abc_001"
  },
  // The interview is linked to its candidate
  {
    "user": "candidate:cand_abc123",
    "relation": "candidate",
    "object": "interview:interview_cand_abc_001"
  }
]
```

### FGA Check Examples

```typescript
// lib/fga.ts
import { OpenFgaClient } from "@openfga/sdk";

const fgaClient = new OpenFgaClient({
  apiUrl: process.env.FGA_API_URL,
  storeId: process.env.AUTH0_FGA_STORE_ID,
  authConfig: {
    method: CredentialsMethod.ClientCredentials,
    config: {
      clientId: process.env.AUTH0_FGA_CLIENT_ID,
      clientSecret: process.env.AUTH0_FGA_CLIENT_SECRET,
      apiAudience: process.env.AUTH0_FGA_API_AUDIENCE,
      apiTokenIssuer: process.env.AUTH0_FGA_API_TOKEN_ISSUER,
    },
  },
});

export async function checkFGA(
  userId: string,
  relation: string,
  object: string,
): Promise<boolean> {
  const { allowed } = await fgaClient.check({
    user: `user:${userId}`,
    relation,
    object,
  });
  return allowed ?? false;
}

// Usage examples:
// Can Alice send an offer? checkFGA("alice", "offer_authority", "candidate:cand_abc123") → true
// Can Bob send an offer?   checkFGA("bob", "offer_authority", "candidate:cand_abc123") → false (triggers CIBA)
// Can Charlie see score?   checkFGA("charlie", "assessor", "candidate:cand_abc123") → false
```

### Test Accounts (Seeded in Demo)

| Account                 | Role           | Auth0 User ID |
| ----------------------- | -------------- | ------------- | -------------------- |
| `alice@headhunt.demo`   | Founder        | `auth0        | founder_alice`       |
| `bob@headhunt.demo`     | Hiring Manager | `auth0        | manager_bob`         |
| `charlie@headhunt.demo` | Interviewer    | `auth0        | interviewer_charlie` |

---

## 8. Connector Strategy

### Gmail — Email Monitoring via Pub/Sub

Gmail does not support traditional webhooks. Headhunt uses the Google Cloud Pub/Sub approach:

1. Create a Pub/Sub topic: `headhunt-gmail-watch`
2. Grant Gmail service account `pubsub.publisher` on the topic
3. Call `gmail.users.watch` with the topic ARN — Gmail pushes a notification whenever a new message arrives in the watched inbox
4. Pub/Sub delivers to `POST /api/webhooks/gmail`
5. Webhook validates the Pub/Sub message, extracts `historyId`, fetches the actual message via Gmail API using Token Vault token

**Rate limit handling:** Gmail API allows 1B quota units/day. Each message fetch is ~5 units. For a hackathon demo, no throttling needed. In production, use exponential backoff on 429 responses and a BullMQ queue for message processing.

**Demo alternative (simpler for hackathon):** Polling endpoint at `GET /api/agents/email-monitor` called every 2 minutes via Supabase Cron. Checks for emails since last `historyId` stored in Supabase.

```typescript
// app/api/webhooks/gmail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getVaultToken } from "@/lib/token-vault";
import { orchestrator } from "@/lib/agents/orchestrator";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const data = JSON.parse(Buffer.from(body.message.data, "base64").toString());

  // data = { emailAddress: "founder@company.com", historyId: "12345" }
  // Fetch new messages since last historyId
  const token = await getVaultToken(FOUNDER_USER_ID, "google-oauth2", [
    "gmail.readonly",
  ]);
  const gmail = createGmailClient(token);

  const history = await gmail.users.history.list({
    userId: "me",
    startHistoryId: data.historyId,
    historyTypes: ["messageAdded"],
  });

  for (const item of history.data.history ?? []) {
    for (const msg of item.messagesAdded ?? []) {
      await orchestrator.handleIncomingEmail(msg.message.id, data.emailAddress);
    }
  }

  return NextResponse.json({ ok: true });
}
```

### Google Calendar — Free/Busy + Event Creation

```typescript
// lib/connectors/calendar.ts
export async function getAvailableSlots(
  userId: string,
  startDate: Date,
  endDate: Date,
  durationMinutes: number = 60,
): Promise<TimeSlot[]> {
  const token = await getVaultToken(userId, "google-oauth2", [
    "calendar.readonly",
  ]);
  const calendar = createCalendarClient(token);

  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busySlots = freeBusy.data.calendars?.primary?.busy ?? [];
  return computeAvailableSlots(startDate, endDate, busySlots, durationMinutes);
}

export async function createInterviewEvent(
  userId: string,
  candidateName: string,
  candidateEmail: string,
  startTime: Date,
  durationMinutes: number,
  jobTitle: string,
): Promise<{ eventId: string; meetLink: string }> {
  const token = await getVaultToken(userId, "google-oauth2", [
    "calendar.events",
  ]);
  const calendar = createCalendarClient(token);

  const event = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Interview: ${candidateName} — ${jobTitle}`,
      start: { dateTime: startTime.toISOString() },
      end: {
        dateTime: new Date(
          startTime.getTime() + durationMinutes * 60000,
        ).toISOString(),
      },
      attendees: [{ email: candidateEmail }],
      conferenceData: {
        createRequest: {
          requestId: `headhunt-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      description: `Headhunt automated interview scheduling for ${jobTitle} role.`,
    },
  });

  return {
    eventId: event.data.id!,
    meetLink: event.data.conferenceData?.entryPoints?.[0]?.uri ?? "",
  };
}
```

### Slack — Interview Summary Posts

```typescript
// lib/connectors/slack.ts
export async function postInterviewSummary(
  userId: string,
  channelId: string,
  summary: InterviewSummary,
): Promise<void> {
  const token = await getVaultToken(userId, "slack", ["chat:write"]);
  const slack = createSlackClient(token);

  await slack.chat.postMessage({
    channel: channelId,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Interview Summary: ${summary.candidateName}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Role:* ${summary.jobTitle}` },
          { type: "mrkdwn", text: `*Stage:* Interviewed` },
          { type: "mrkdwn", text: `*Overall Score:* ${summary.score}/100` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:*\n${summary.interviewNotes}` },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Candidate" },
            url: `${process.env.NEXT_PUBLIC_APP_URL}/candidates/${summary.candidateId}`,
          },
        ],
      },
    ],
  });
}
```

### Tumblr — Auto-Post Job Listing

```typescript
// lib/connectors/tumblr.ts
export async function postJobToTumblr(
  userId: string,
  job: Job,
): Promise<string> {
  const token = await getVaultToken(userId, "tumblr", ["write"]);

  const response = await fetch(
    `https://api.tumblr.com/v2/blog/${process.env.TUMBLR_BLOG_IDENTIFIER}/posts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: [
          { type: "text", text: `🚀 We're hiring: ${job.title}` },
          { type: "text", text: job.description },
          {
            type: "text",
            text: `Apply: ${process.env.NEXT_PUBLIC_APP_URL}/apply/${job._id}`,
          },
        ],
        tags: ["hiring", "jobs", job.tags.join(",")],
      }),
    },
  );

  const data = await response.json();
  return data.response?.id_string ?? "";
}
```

---

## 9. Mock CRM Design (The Platform's Internal Database)

The platform IS the CRM. Supabase stores all hiring data. No Google Sheets dependency.

### Tables Overview

| Table      | Purpose                                   |
| --------------- | ----------------------------------------- |
| `organizations` | Company/tenant record                     |
| `users`         | Platform users with roles                 |
| `jobs`          | Job postings                              |
| `candidates`    | Parsed candidate profiles                 |
| `applications`  | Candidate ↔ Job link with pipeline state  |
| `interviews`    | Interview records                         |
| `email_threads` | Tracked email conversations per candidate |
| `templates`     | Email templates with variable slots       |
| `offers`        | Offer letter drafts and status            |
| `audit_logs`    | Immutable agent action log                |

---

## 10. Email/Notification System

### Email Template System

Templates are stored in Supabase and use `{{handlebars}}` syntax:

```json
{
  "id": "tmpl_interview_outreach",
  "organizationId": "org_acme",
  "type": "interview_invitation",
  "name": "Interview Invitation",
  "subject": "Interview Opportunity: {{jobTitle}} at {{companyName}}",
  "body": "Hi {{candidateName}},\n\nThank you for your interest in the {{jobTitle}} role at {{companyName}}.\n\nI checked my live Cal availability for a {{durationMinutes}}-minute conversation and these slots are currently free:\n{{slotOptions}}\n\nPlease reply with the option number(s) that work for you, or suggest alternatives.\n\nBest,\n{{senderName}}\n{{companyName}}",
  "variables": [
    "candidateName",
    "jobTitle",
    "companyName",
    "durationMinutes",
    "slotOptions",
    "senderName"
  ],
  "createdAt": "2026-03-01T00:00:00.000Z",
  "updatedAt": "2026-03-01T00:00:00.000Z"
}
```

### Notification Routing

- Slack: interview briefs, offer clearance confirmations, hire announcements, pipeline daily digests
- Email:
  - Cal: booking/invite notifications for Cal-managed interviews
  - Dispatch: offer letter and related approval outcomes
  - Founder-sent interview confirmation: used only for non-Cal scheduling paths
- Push (CIBA): offer hold clearance, Tumblr publish confirm, GDPR delete confirm
- In-app: stage transitions, Triage failures, token expiry warnings

### Transcript Summary Flow (Demo)

1. Interview is booked in Cal and stored with `googleCalendarEventId = cal:<bookingUid>`.
2. Operator runs transcript summary using booking UID.
3. System fetches transcript URLs from Cal and extracts transcript text.
4. If Cal transcript text is missing/unreadable, operator runs Drive PDF fallback summary.
5. System produces structured debrief:
  - recommendation,
  - rubric score,
  - strengths,
  - risks,
  - actionable follow-ups,
  - interviewer action items.
6. Founder/hiring manager chooses next branch:
  - proceed to next round,
  - draft offer,
  - hold for more signals,
  - reject.

### CIBA Implementation

```typescript
// lib/auth0-ciba.ts
export async function initiateCIBA(params: {
  loginHint: string; // Auth0 user ID of the approver
  bindingMessage: string; // Short message shown on both sides
  scope: string;
  authorizationDetails: object;
  requestedAction: string;
}): Promise<{ authReqId: string; expiresIn: number }> {
  const response = await fetch(
    `https://${process.env.AUTH0_DOMAIN}/bc-authorize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        login_hint: JSON.stringify({
          format: "iss_sub",
          iss: process.env.AUTH0_ISSUER_BASE_URL,
          sub: params.loginHint,
        }),
        binding_message: params.bindingMessage,
        scope: params.scope,
        authorization_details: JSON.stringify(params.authorizationDetails),
        requested_expiry: "300", // 5 minute window
      }),
    },
  );

  const data = await response.json();
  return { authReqId: data.auth_req_id, expiresIn: data.expires_in };
}

export async function pollCIBAResult(
  authReqId: string,
): Promise<"approved" | "denied" | "pending"> {
  const response = await fetch(
    `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        grant_type: "urn:openid:params:grant-type:ciba",
        auth_req_id: authReqId,
      }),
    },
  );

  if (response.status === 200) return "approved";
  const err = await response.json();
  if (err.error === "authorization_pending") return "pending";
  if (err.error === "access_denied") return "denied";
  throw new Error(`CIBA poll error: ${err.error}`);
}
```

---

## 11. Platform: Beyond the Launch

### MCP Server Portability

The Auth0-secured MCP server at `https://headhunt.app/mcp` can be added to any MCP-compatible client:

**Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "headhunt": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://headhunt.app/mcp"
      ],
      "env": {
        "BEARER_TOKEN": "<founder_auth0_access_token>"
      }
    }
  }
}
```

**Available from Claude Desktop:**

- "What's the status of my engineering search?"
- "Who are my top 3 candidates for the Product Manager role?"
- "Are there any candidates I haven't reviewed yet?"
- "Has Dispatch sent Priya's offer yet?"

### Auth0 Token Validation in MCP

Every MCP tool call validates the JWT against Auth0:

1. Verify signature using Auth0 JWKS endpoint
2. Verify `aud` claim matches `AUTH0_MCP_AUDIENCE`
3. Extract `sub` (user ID) and check FGA for the requested data
4. Log the MCP access to audit logs

---

## 12. Analytics & Audit Layer

### Audit Log Design

Every agent action is written to both Supabase and Auth0 Audit Logs. The Supabase copy enables the "time-travel" UX (see below).

```typescript
// lib/audit.ts
export async function logAgentAction(action: AuditEvent): Promise<void> {
  await supabase.from("audit_logs").insert({
    ...action,
    timestamp: new Date().toISOString(),
  });

  // Also emit to Auth0 Log Streaming (if configured)
  // Auth0 captures these via the Management API event stream
}

export type AuditEvent = {
  organizationId: string;
  actorType: "agent" | "user";
  actorId: string; // agent name or user ID
  actorDisplayName: string;
  action: string; // e.g., "candidate.scored", "offer.ciba_initiated"
  resourceType: "candidate" | "job" | "offer" | "interview" | "email";
  resourceId: string;
  metadata: Record<string, unknown>;
  cibaAuthReqId?: string; // if action was CIBA-gated
  cibaApprovedBy?: string; // user ID of CIBA approver
  tokenVaultConnection?: string;
  fgaRelationChecked?: string;
  result: "success" | "denied" | "pending";
};
```

### The "Time-Travel" UX

On the Candidate Detail screen, a vertical timeline shows every agent action and human decision for that candidate, with timestamps. This is the audit layer surfaced as a feature:

```
[09:14] 📧 Intercept detected application from Gmail
[09:14] 🤖 Triage → matched to job: Senior Engineer
[09:15] 🤖 Analyst → scored 82/100
[09:15] 📋 Candidate card created in pipeline
[09:45] 👤 Alice (Founder) moved to "Interview" stage
[09:46] 📧 Liaison drafted invitation email
[09:46] 👤 Alice approved email send
[09:46] 📧 Interview invitation sent to candidate@email.com
[Mar 12] 📧 Candidate replied with availability
[Mar 12] 🤖 Liaison detected scheduling reply
[Mar 12] 📅 Calendar slot selected: Mar 15, 2pm IST
[Mar 12] 📅 Google Meet event created: meet.google.com/abc-xyz
[Mar 12] 📧 Confirmation email sent
[Mar 15] 🎤 Interview completed
[Mar 15] 🤖 Liaison generated interview notes
[Mar 15] 💬 Slack summary posted to #hiring
[Mar 16] 👤 Bob (Hiring Manager) initiated offer: $130K
[Mar 16] 🔐 CIBA notification sent to Alice (Founder)
[Mar 16] ✅ Alice approved offer via Auth0 Guardian
[Mar 16] 📧 Dispatch sent offer letter to candidate@email.com
[Mar 17] 🎉 Candidate accepted. Stage: Hired
```

---

## 13. UX Philosophy & Flows

### Core Principle: No Chat Interface

Headhunt is not a chatbot. The agent interactions are invisible infrastructure. The UI surfaces results, not conversations.

**Non-chat patterns used:**

1. **Pipeline Kanban:** Candidate cards move through columns. Each card shows name, score badge, last action, and stage. Action buttons on each card trigger agent flows.

2. **AI-Rendered Calendar Slot Picker:** When the agent computes available slots, it returns a `SchedulingPayload` JSON object. The frontend renders this as a visual calendar grid — not a list of text options. The founder clicks a slot. No typing required.

3. **Candidate Intelligence Card:** Not a wall of text. Structured sections: Overview (name, role, score), Qualifications Match (checklist vs. JD requirements), Work History (timeline), Agent Reasoning (why scored this way), Raw Summary. Expandable.

4. **Approval Queue:** A dedicated screen showing all pending CIBA approvals and draft emails waiting for human send-approval. Founders have one place to review everything that needs their decision.

5. **Audit Timeline:** Per-candidate vertical timeline showing every action (see above). This is the "receipts" view.

### AI-Rendered Calendar Picker — Technical Flow

```typescript
// app/api/agents/schedule/route.ts
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const SchedulingPayload = z.object({
  slots: z.array(
    z.object({
      startISO: z.string(),
      endISO: z.string(),
      displayLabel: z.string(), // e.g., "Wed Mar 19, 2:00 PM – 3:00 PM IST"
      confidence: z.enum(["ideal", "acceptable", "last_resort"]),
    }),
  ),
  recommendedSlotIndex: z.number(),
  reasoning: z.string(),
});

export async function POST(req: NextRequest) {
  const { jobId, candidateId, candidateAvailabilityText } = await req.json();

  const freeSlots = await getAvailableSlots(userId, startDate, endDate, 60);

  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: SchedulingPayload,
    prompt: `
      Candidate availability: "${candidateAvailabilityText}"
      Founder's free slots: ${JSON.stringify(freeSlots)}
      Pick the best 3-5 slots that overlap. Mark the best one as recommended.
      Prefer mornings (9am-12pm) and mid-week (Tue-Thu).
    `,
  });

  return NextResponse.json(object);
  // Frontend receives this and renders a visual slot picker grid
}
```

---

## 14. Screen-by-Screen Spec

### Screen 1 — Dashboard (`/`)

**Layout:** 3-column stat cards at top (Total Active Jobs, Candidates This Week, Interviews Scheduled). Below: a list of active jobs with candidate funnel mini-charts. Right sidebar: Approval Queue (pending CIBA / draft emails awaiting send).

**Components:** `<StatCard>`, `<JobRow>`, `<ApprovalQueue>`

**Agent interaction:** Real-time candidate count updates via polling or SSE.

---

### Screen 2 — Job List (`/jobs`)

Grid of job cards. Each card: title, status badge, posted date, Tumblr post link, candidate count by stage. CTA: "Create Job" (top right).

---

### Screen 3 — Create Job (`/jobs/new`)

**Form sections:**

1. Basic info: Title, Department, Location (remote/hybrid/onsite), Employment type
2. Job Description (rich text editor)
3. Requirements (bullet list, draggable, each marked as Required/Preferred)
4. Scoring Dimensions (AI auto-suggests from JD, founder can edit): e.g., "Years of experience", "TypeScript proficiency", "Startup experience" — each weighted
5. Compensation: Range (min/max), Currency, Equity (%)
6. Templates to use: Interview Invitation, Offer Letter (dropdowns linking to Templates screen)

**On submit:** Creates `job` row in Supabase → triggers `TumblrConnector.postJob()` → CIBA push to founder for Tumblr publish confirmation.

---

### Screen 4 — Job Pipeline (`/jobs/[jobId]`)

**Layout:** Horizontal kanban with columns: Applied → Reviewed → Interview Scheduled → Interviewed → Offer Sent → Hired / Rejected.

**Candidate Card Component:**

- Name + initials avatar
- Score badge (color-coded: green ≥70, amber 50–69, red <50)
- Applied N days ago
- Top qualification match (e.g., "✅ 5 yrs TypeScript")
- Action buttons: "View" | "Interview" | "Reject"
- On drag between columns: updates `stage` via API, logs to audit.

**FGA enforcement on frontend:** "Interview" and "Reject" buttons disabled for `interviewer` role users. "Offer" button absent for `hiring_manager` (they use "Request Offer Approval" instead).

---

### Screen 5 — Candidate Detail (`/jobs/[jobId]/candidates/[candidateId]`)

**Sections:**

1. **Header:** Name, applied role, stage badge, action buttons
2. **Score Card:** Circular score gauge + breakdown bars per dimension
3. **Qualification Checklist:** Each job requirement checked/unchecked with evidence note
4. **Work History:** Timeline of previous roles (parsed from resume/email)
5. **Agent Reasoning:** Collapsible — why the agent scored this way
6. **Email Thread:** All Gmail correspondence with this candidate, threaded
7. **Audit Timeline:** Full history of agent and human actions
8. **Interview Notes:** Post-interview summary (if available)

**Conditional UI — Calendar Slot Picker:**
Appears inline when founder clicks "Schedule Interview." Renders as a weekly grid showing available slots color-coded by agent confidence. Founder clicks a slot → agent proceeds to create calendar event.

---

### Screen 6 — Settings: Templates (`/settings/templates`)

List of email templates. Each template: name, type (invitation/offer/rejection/follow-up), preview. Inline editor with variable highlighting. Preview with dummy data.

---

### Screen 7 — Settings: Integrations (`/settings/integrations`)

**Sections:**

- Connected accounts (Gmail, Calendar, Slack, Tumblr) — shows connection status, connected email/handle, "Reconnect" or "Disconnect" buttons. Each connection goes through Auth0 Token Vault OAuth flow.
- MCP Server: "Copy MCP URL" button + auth token generator for Claude Desktop config.
- Slack: Channel selector for interview summaries.

---

### Screen 8 — Audit Log (`/audit`)

Full table of audit events, filterable by date, actor (agent/user), action type, resource. Click any row to see full event JSON. Exportable as CSV. This is the "time machine" for the full organization.

---

### Screen 9 — Approval Queue (`/approvals`)

Cards for all pending approvals:

- CIBA-initiated approvals awaiting founder response (with live countdown timer to expiry)
- Draft emails awaiting human send-approval
- Each card shows: action requested, by whom, on which candidate, what the email/offer says.
- "View Full Draft" expander. "Approve" and "Deny" buttons.

---

## 15. Data Models

### `organizations`

```json
{
  "id": "org_acme",
  "name": "Acme Inc.",
  "slug": "acme",
  "auth0OrgId": "org_auth0_xxx",
  "founderUserId": "auth0|founder_alice",
  "slackWorkspaceId": "T0123456",
  "slackHiringChannelId": "C0987654",
  "tumblrBlogIdentifier": "acme-hiring",
  "gmailWatchedEmail": "hiring@acme.com",
  "gmailHistoryId": "12345678",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### `jobs`

```json
{
  "id": "job_senior_eng_001",
  "organizationId": "org_acme",
  "title": "Senior Software Engineer",
  "department": "Engineering",
  "locationType": "remote",
  "employmentType": "full_time",
  "status": "active",
  "description": "We are looking for...",
  "requirements": [
    { "text": "5+ years TypeScript", "required": true, "scoringWeight": 0.3 },
    { "text": "React experience", "required": true, "scoringWeight": 0.2 },
    { "text": "Startup experience", "required": false, "scoringWeight": 0.15 }
  ],
  "compensation": {
    "min": 120000,
    "max": 160000,
    "currency": "USD",
    "equity": "0.1-0.5%"
  },
  "scoringCriteria": [
    "years_experience",
    "technical_depth",
    "startup_fit",
    "communication"
  ],
  "interviewTemplateId": "tmpl_interview_outreach",
  "offerTemplateId": "tmpl_offer_letter",
  "tumblrPostId": "987654321",
  "candidateCount": 24,
  "createdAt": "2026-03-01T00:00:00.000Z",
  "updatedAt": "2026-04-01T00:00:00.000Z"
}
```

### `candidates`

```json
{
  "id": "cand_abc123",
  "organizationId": "org_acme",
  "jobId": "job_senior_eng_001",
  "name": "Priya Mehta",
  "contactEmail": "priya.mehta@gmail.com",
  "stage": "interview_scheduled",
  "score": 82,
  "scoreBreakdown": {
    "years_experience": {
      "score": 90,
      "note": "7 years TypeScript at Razorpay and Postman"
    },
    "technical_depth": {
      "score": 85,
      "note": "Led architecture of payments microservice"
    },
    "startup_fit": { "score": 80, "note": "Worked at 2 early-stage startups" },
    "communication": {
      "score": 72,
      "note": "Email well-structured, clear writing"
    }
  },
  "summary": "Strong TypeScript engineer with fintech background. Led backend architecture at Razorpay. No React mentioned — risk area. Strong startup cultural fit.",
  "workHistory": [
    { "company": "Razorpay", "role": "Senior Engineer", "period": "2021–2024" },
    { "company": "Postman", "role": "Engineer", "period": "2019–2021" }
  ],
  "qualificationChecks": [
    {
      "requirement": "5+ years TypeScript",
      "met": true,
      "evidence": "7 years mentioned in email"
    },
    {
      "requirement": "React experience",
      "met": false,
      "evidence": "Not mentioned"
    }
  ],
  "sourceEmail": {
    "gmailMessageId": "msg_18e4f2a...",
    "gmailThreadId": "thread_18e4f...",
    "receivedAt": "2026-04-01T09:14:00.000Z",
    "hasAttachment": true,
    "attachmentNames": ["priya_mehta_resume.pdf"]
  },
  "interviewId": "interview_priya_001",
  "offerId": null,
  "agentRunId": "run_classifier_001",
  "createdAt": "2026-04-01T09:15:00.000Z",
  "updatedAt": "2026-04-01T10:30:00.000Z"
}
```

### `interviews`

```json
{
  "id": "interview_priya_001",
  "organizationId": "org_acme",
  "candidateId": "cand_abc123",
  "jobId": "job_senior_eng_001",
  "scheduledAt": "2026-04-05T08:30:00.000Z",
  "durationMinutes": 60,
  "googleCalendarEventId": "evt_xyz789",
  "googleMeetLink": "https://meet.google.com/abc-xyz-def",
  "status": "scheduled",
  "interviewerUserIds": ["auth0|manager_bob"],
  "summary": null,
  "slackMessageTs": null,
  "createdAt": "2026-04-01T10:30:00.000Z"
}
```

### `templates`

```json
{
  "id": "tmpl_offer_letter",
  "organizationId": "org_acme",
  "type": "offer_letter",
  "name": "Standard Offer Letter",
  "subject": "Offer of Employment — {{jobTitle}} at {{companyName}}",
  "body": "Dear {{candidateName}},\n\nWe are pleased to extend an offer of employment for the position of {{jobTitle}} at {{companyName}}.\n\nCompensation: {{salary}} per annum\nStart Date: {{startDate}}\nEquity: {{equity}}\n\nThis offer is contingent upon successful completion of background verification.\n\nPlease confirm your acceptance by replying to this email.\n\nWarm regards,\n{{founderName}}\n{{companyName}}",
  "variables": [
    "candidateName",
    "jobTitle",
    "companyName",
    "salary",
    "startDate",
    "equity",
    "founderName"
  ],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### `offers`

```json
{
  "id": "offer_priya_001",
  "organizationId": "org_acme",
  "candidateId": "cand_abc123",
  "jobId": "job_senior_eng_001",
  "status": "awaiting_approval",
  "draftContent": "Dear Priya,\n\nWe are pleased to...",
  "terms": {
    "salary": 145000,
    "currency": "USD",
    "startDate": "2026-05-01",
    "equity": "0.25%"
  },
  "initiatedBy": "auth0|manager_bob",
  "cibaAuthReqId": "auth_req_xyz123",
  "cibaApprovedBy": null,
  "sentAt": null,
  "candidateResponse": null,
  "createdAt": "2026-04-06T10:00:00.000Z"
}
```

### `audit_logs`

```json
{
  "id": "audit_evt_001",
  "organizationId": "org_acme",
  "actorType": "agent",
  "actorId": "CandidateProfiler",
  "actorDisplayName": "Candidate Profiler Agent",
  "action": "candidate.scored",
  "resourceType": "candidate",
  "resourceId": "cand_abc123",
  "metadata": {
    "score": 82,
    "model": "gpt-4o-mini",
    "tokenVaultConnection": "google-oauth2",
    "fgaRelationChecked": null,
    "durationMs": 2341
  },
  "result": "success",
  "timestamp": "2026-04-01T09:15:22.000Z"
}
```

---

## 16. Validation Tracker

### Testing Philosophy: Evidence-First

Every Auth0 integration must be proven with a terminal command or a verifiable API response before the demo recording. No hand-waving.

### Test Checklist

```bash
# ── FGA ──────────────────────────────────────────────────────────────────────

# 1. Alice (founder) can check offer_authority on candidate
curl -X POST https://api.us1.fga.dev/stores/$FGA_STORE_ID/check \
  -H "Authorization: Bearer $FGA_TOKEN" \
  -d '{"tuple_key":{"user":"user:alice","relation":"offer_authority","object":"candidate:cand_abc123"}}'
# Expected: { "allowed": true }

# 2. Bob (hiring_manager) cannot check offer_authority
curl -X POST https://api.us1.fga.dev/stores/$FGA_STORE_ID/check \
  -H "Authorization: Bearer $FGA_TOKEN" \
  -d '{"tuple_key":{"user":"user:bob","relation":"offer_authority","object":"candidate:cand_abc123"}}'
# Expected: { "allowed": false }

# 3. Charlie (interviewer) cannot check assessor on candidate outside their interview
curl -X POST https://api.us1.fga.dev/stores/$FGA_STORE_ID/check \
  -H "Authorization: Bearer $FGA_TOKEN" \
  -d '{"tuple_key":{"user":"user:charlie","relation":"assessor","object":"candidate:cand_abc123"}}'
# Expected: { "allowed": false }

# ── TOKEN VAULT ───────────────────────────────────────────────────────────────

# 4. Verify Token Vault returns a Gmail access token for Alice
curl -X POST https://$AUTH0_DOMAIN/api/v2/users/auth0|founder_alice/tokens/google-oauth2 \
  -H "Authorization: Bearer $MGMT_API_TOKEN" \
  -d '{"scopes":["gmail.readonly"]}'
# Expected: { "access_token": "ya29.xxx..." }

# 5. Verify the returned token can actually call Gmail
GMAIL_TOKEN=$(above)
curl "https://gmail.googleapis.com/gmail/v1/users/me/profile" \
  -H "Authorization: Bearer $GMAIL_TOKEN"
# Expected: { "emailAddress": "alice@acme.com", ... }

# ── CIBA ─────────────────────────────────────────────────────────────────────

# 6. Initiate CIBA for offer approval
curl -X POST https://$AUTH0_DOMAIN/bc-authorize \
  -d "client_id=$AUTH0_CLIENT_ID" \
  -d "client_secret=$AUTH0_CLIENT_SECRET" \
  -d "login_hint={\"format\":\"iss_sub\",\"iss\":\"$AUTH0_DOMAIN\",\"sub\":\"auth0|founder_alice\"}" \
  -d "binding_message=Approve offer to Priya: 145K, May 1 start" \
  -d "scope=openid"
# Expected: { "auth_req_id": "...", "expires_in": 300 }
# Action: Check Auth0 Guardian app on phone — push notification should arrive

# 7. Poll for CIBA result
curl -X POST https://$AUTH0_DOMAIN/oauth/token \
  -d "grant_type=urn:openid:params:grant-type:ciba" \
  -d "client_id=$AUTH0_CLIENT_ID" \
  -d "client_secret=$AUTH0_CLIENT_SECRET" \
  -d "auth_req_id=$AUTH_REQ_ID"
# Expected after approval: { "access_token": "...", "id_token": "..." }

# ── MCP ──────────────────────────────────────────────────────────────────────

# 8. MCP server responds to list_jobs tool call
curl -X POST https://localhost:3000/mcp \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"list_jobs","arguments":{}}}'
# Expected: JSON array of Alice's active jobs

# ── AGENTS ───────────────────────────────────────────────────────────────────

# 9. Trigger Intercept manually (demo polling)
curl -X POST https://localhost:3000/api/agents/intercept \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN"
# Expected: { "processed": 2, "candidatesCreated": 1, "schedulingReplies": 1 }

# 10. Trigger Analyst with mock email body
curl -X POST https://localhost:3000/api/agents/analyst \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -d '{"jobId":"job_senior_eng_001","emailBody":"Hi, I am Priya Mehta..."}'
# Expected: Full candidate JSON with score and breakdown
```

---

## 17. MVP Scope vs. Post-Hackathon

### ✅ MVP (Ship by Apr 6)

| Feature                                                  | Notes                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Job creation with Tumblr post                            | CIBA for Tumblr publish confirmation                                              |
| Gmail monitoring (polling, not Pub/Sub)                  | Polling every 2 min via Supabase Cron                                               |
| Classifier + Profiler agents                             | `generateObject` calls, one per email                                             |
| Candidate pipeline (kanban)                              | Drag-drop for stage changes                                                       |
| Candidate Intelligence Card                              | Full breakdown view                                                               |
| Calendar slot picker (AI-rendered)                       | `generateObject` → visual grid UI                                                 |
| Interview invitation email (draft + human send-approval) | Template-based                                                                    |
| Confirmation email + Meet link creation                  | Auto-sent on slot selection                                                       |
| Slack interview summary                                  | Post-interview trigger                                                            |
| Offer letter drafting                                    | Template + term form                                                              |
| CIBA for offer approval (hiring manager → founder)       | Core demo moment                                                                  |
| FGA with 3 roles (founder, hiring_manager, interviewer)  | Enforced on all API routes                                                        |
| Token Vault for Gmail, Calendar, Slack, Tumblr           | All tokens via vault, none in env                                                 |
| Audit log timeline per candidate                         | Display only, no export                                                           |
| MCP server (4 tools)                                     | `list_jobs`, `get_candidate_detail`, `list_pipeline`, `summarize_pipeline_health` |

### ❌ Post-Hackathon (v2)

| Feature                                             | Reason Deferred                                       |
| --------------------------------------------------- | ----------------------------------------------------- |
| Gmail Pub/Sub (real-time instead of polling)        | GCP setup overhead; polling works for demo            |
| Automatic interview summary from Meet transcript    | Meet transcript API requires specific Workspace setup |
| Bulk reject CIBA (step-up on self)                  | Third CIBA flow; cut for time                         |
| AI-assisted candidate filtering inside platform     | v2 "AI filter" feature                                |
| Additional job board publishing (LinkedIn, X, etc.) | Tumblr is the proof of concept                        |
| Recruiter role                                      | Start with 3 roles, expand after                      |
| Audit log export (CSV)                              | Backend simple, frontend deferred                     |
| Email reply threading (multi-turn scheduling)       | Implement basic; full threading is v2                 |

---

## 18. Product Flywheel

**Phase 1 — Signal:** One founder. One team. End-to-end it works. Headhunt reads every application, routes every email, books every interview. Dispatch holds every offer. The founder touches nothing until a decision is actually required.

**Phase 2 — Spread:** Headhunt's MCP server creates habit-forming distribution. Founders who plug it into Claude Desktop never come back to a browser to check on their pipeline. They ask instead. "What's my engineering search looking like?" becomes a daily ritual. They tell other founders. That sentence — "you can just ask Claude about your hiring pipeline" — is a Slack message, not a marketing campaign.

**Phase 3 — Scale:** Auth0 Organizations. Each startup gets its own tenant. FGA scales to org-level permission inheritance. Billing by active search seat. Founders grow teams; FGA grows the role graph with them. Add `recruiter`, `legal_reviewer`, `compensation_approver` without a schema change.

**Phase 4 — Loop:** Candidates who accept offers through Headhunt get a message: "Your new employer runs on Headhunt." Onboarding picks up the moment the offer clears. The platform that closes the hire becomes the platform that starts the job. Two products. One handshake. Signed by Dispatch.

---

## 19. Tech Stack & Repo Structure

```
headhunt/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── callback/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                    # Auth guard + FGA role loader
│   │   ├── page.tsx                      # Dashboard
│   │   ├── jobs/
│   │   │   ├── page.tsx                  # Job list
│   │   │   ├── new/page.tsx              # Create job form
│   │   │   └── [jobId]/
│   │   │       ├── page.tsx              # Job pipeline (kanban)
│   │   │       └── candidates/
│   │   │           └── [candidateId]/
│   │   │               └── page.tsx      # Candidate detail
│   │   ├── approvals/page.tsx            # Clearance Queue (CIBA holds)
│   │   ├── field-log/page.tsx            # Field Log viewer
│   │   └── settings/
│   │       ├── integrations/page.tsx
│   │       └── templates/page.tsx
│   └── api/
│       ├── agents/
│       │   ├── email-monitor/route.ts    # Polling endpoint + Pub/Sub handler
│       │   ├── classify/route.ts
│       │   ├── parse-candidate/route.ts
│       │   ├── schedule/route.ts         # Slot computation + generateObject
│       │   ├── summarize-interview/route.ts
│       │   └── offer-letter/route.ts
│       ├── mcp/route.ts                  # MCP server HTTP transport
│       ├── webhooks/
│       │   └── gmail/route.ts            # Pub/Sub push endpoint
│       ├── jobs/
│       │   ├── route.ts                  # GET all, POST create
│       │   └── [jobId]/route.ts
│       ├── candidates/
│       │   ├── route.ts
│       │   └── [candidateId]/
│       │       ├── route.ts
│       │       └── stage/route.ts        # PATCH stage change (FGA-checked)
│       ├── offers/
│       │   ├── route.ts                  # POST create offer
│       │   └── [offerId]/
│       │       ├── approve/route.ts      # POST — CIBA poll result handler
│       │       └── send/route.ts         # POST — send offer email
│       └── auth/
│           ├── callback/route.ts
│           └── connect/[provider]/route.ts  # Token Vault OAuth initiation
├── components/
│   ├── pipeline/
│   │   ├── KanbanBoard.tsx
│   │   ├── CandidateCard.tsx
│   │   └── StageColumn.tsx
│   ├── candidate/
│   │   ├── IntelCard.tsx
│   │   ├── ScoreBreakdown.tsx
│   │   ├── WorkHistory.tsx
│   │   ├── QualificationChecklist.tsx
│   │   └── FieldLog.tsx
│   ├── scheduling/
│   │   └── CalendarSlotPicker.tsx        # Renders SchedulingPayload as grid
│   ├── approvals/
│   │   └── ClearanceCard.tsx
│   └── ui/                               # Shared design system components
├── lib/
│   ├── auth0.ts                          # Auth0 SDK init
│   ├── fga.ts                            # OpenFGA client + checkFGA helper
│   ├── token-vault.ts                    # Vault token getter
│   ├── ciba.ts                           # CIBA initiate + poll
│   ├── db/
│   │   ├── supabase.ts                   # Supabase client
│   │   └── types/                        # Supabase generated types
│   ├── agents/
│   │   ├── control.ts
│   │   ├── intercept.ts
│   │   ├── triage.ts
│   │   ├── analyst.ts
│   │   ├── liaison.ts
│   │   └── dispatch.ts
│   ├── connectors/
│   │   ├── gmail.ts
│   │   ├── calendar.ts
│   │   ├── slack.ts
│   │   └── tumblr.ts
│   └── audit.ts                          # Audit log writer
├── mcp-server/
│   ├── index.ts                          # MCP server definition
│   └── auth-middleware.ts
├── middleware.ts                          # Auth0 route protection
├── supabase/                              # Supabase config (cron, functions)
└── .env.local
```

**`supabase/functions/email-cron/index.ts` — Cron for Email Polling:**

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  // Call the Next.js API endpoint
  await fetch(`${Deno.env.get("NEXT_PUBLIC_APP_URL")}/api/agents/email-monitor`);
  return new Response("Cron triggered", { status: 200 });
});
```
*Note: Configured via `pg_cron` in Supabase dashboard to run every 2 minutes.*

---

## 20. Environment Variables

```bash
# ── Auth0 Core ────────────────────────────────────────────────────────────────
AUTH0_SECRET=                        # 32-char random secret for session encryption
AUTH0_BASE_URL=                      # https://headhunt.vercel.app
AUTH0_ISSUER_BASE_URL=               # https://your-tenant.auth0.com
AUTH0_CLIENT_ID=                     # Main app client ID
AUTH0_CLIENT_SECRET=                 # Main app client secret
AUTH0_AUDIENCE=                      # https://api.headhunt.app
AUTH0_MCP_AUDIENCE=                  # https://mcp.headhunt.app (separate audience for MCP)

# ── Auth0 Management API (for Token Vault) ────────────────────────────────────
AUTH0_MGMT_CLIENT_ID=                # M2M client with read:user_idp_tokens scope
AUTH0_MGMT_CLIENT_SECRET=

# ── Auth0 FGA ─────────────────────────────────────────────────────────────────
AUTH0_FGA_STORE_ID=
AUTH0_FGA_CLIENT_ID=
AUTH0_FGA_CLIENT_SECRET=
AUTH0_FGA_API_AUDIENCE=              # https://api.us1.fga.dev/
AUTH0_FGA_API_TOKEN_ISSUER=          # fga.us.auth0.com
FGA_API_URL=                         # https://api.us1.fga.dev

# ── Database ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=            # https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=           # eyJ...

# ── AI ────────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=                      # For Vercel AI SDK (gpt-4o-mini for agents)

# ── Google (configured in Auth0 Social Connections, but needed for Pub/Sub) ──
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_PUBSUB_TOPIC=                 # projects/{id}/topics/headhunt-gmail-watch
GMAIL_WATCHED_EMAIL=                 # hiring@yourdomain.com

# ── Slack ─────────────────────────────────────────────────────────────────────
# (Token stored in Token Vault — only need default channel ID here)
DEFAULT_SLACK_CHANNEL_ID=

# ── Tumblr ────────────────────────────────────────────────────────────────────
TUMBLR_BLOG_IDENTIFIER=             # your-blog-name (without .tumblr.com)

# ── App ───────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=                 # https://headhunt.vercel.app
CRON_SECRET=                         # Secret to validate Supabase Cron calls
```

---

## 21. Post-Hackathon Roadmap

### Q2 2026 — Stabilise

- Replace polling with Gmail Pub/Sub (real-time email detection)
- Add Meet transcript summary (Google Drive recording → transcript → summary)
- Bulk reject CIBA (step-up auth on self)
- Audit log CSV export
- Full email reply threading for scheduling back-and-forth

### Q3 2026 — Expand

- Multi-tenant Auth0 organizations (each startup is an org)
- `recruiter` role (4th FGA role: source-only, no decisions)
- Referral links per job (tracking source of application)
- Job posting to X and LinkedIn (v2 multi-platform)
- Stripe billing by active job seats

### Q4 2026 — Network

- EchoOrg integration: offer acceptance triggers onboarding memory graph seeding
- Candidate self-service portal (track application status)
- Interviewer feedback forms (structured, not free-text)
- Analytics: time-to-hire, source quality, stage conversion rates

---

## 22. Appendices

### Appendix A — FGA Store Bootstrap Script

```typescript
// scripts/bootstrap-fga.ts
import { OpenFgaClient } from "@openfga/sdk";

const fga = new OpenFgaClient({
  /* config */
});

async function bootstrap() {
  // Write the model
  await fga.writeAuthorizationModel({
    schema_version: "1.1",
    type_definitions: [
      /* ... DSL compiled to JSON ... */
    ],
  });

  // Seed demo tuples
  await fga.write({
    writes: {
      tuple_keys: [
        {
          user: "user:alice",
          relation: "founder",
          object: "organization:acme",
        },
        {
          user: "user:bob",
          relation: "hiring_manager",
          object: "organization:acme",
        },
        {
          user: "user:charlie",
          relation: "hiring_manager",
          object: "organization:acme",
        },
        {
          user: "organization:acme",
          relation: "organization",
          object: "job:senior_eng_001",
        },
      ],
    },
  });

  console.log("FGA store bootstrapped.");
}

bootstrap();
```

Run: `npx ts-node scripts/bootstrap-fga.ts`

---

### Appendix B — Demo Seed Data Script

```typescript
// scripts/seed-demo.ts
// Seeds Supabase with realistic demo data:
// - 1 organization (org_acme)
// - 2 active jobs (Senior Engineer, Product Manager)
// - 8 candidates across various stages
// - 3 interviews (1 completed with summary, 1 scheduled, 1 pending)
// - 2 email templates
// - 1 offer in awaiting_approval state (triggers CIBA demo)
// Run: npx ts-node scripts/seed-demo.ts
```

---

### Appendix C — 3-Minute Demo Script

```
00:00 – 00:30  Open the dashboard. Two active searches. Eight candidates in pipeline.
               "Headhunt auto-scored eight applications overnight. I didn't
               touch any of them." Show Ops Board kanban.

00:30 – 01:00  Open Priya's Intel Card. Score 82/100. Breakdown by dimension.
               "Analyst read her resume, compared it against the JD, and
               generated this. Every score has a quote from the actual resume.
               No black box."

01:00 – 01:30  Click Interview. Calendar slot picker appears from Liaison.
               "Liaison queried my Google Calendar. I pick a slot. It creates
               the Meet event and sends the confirmation — automatically."
               Show confirmation email rendered in the timeline.

01:30 – 02:00  Open Clearance Queue. Dispatch holding an offer for Jane.
               "Bob, my hiring manager, drafted an offer. But FGA says only
               the founder has offer_authority. So Dispatch is holding it —
               right here — waiting for clearance."

02:00 – 02:30  Show Auth0 Guardian on phone. CIBA push arrives.
               "'Dispatch is holding an offer for Jane: $120K, May start.
               Confirm to release.' I tap Approve. Watch the card move."
               Show candidate stage flip to Offer Sent live.

02:30 – 03:00  Switch to Claude Desktop. Ask: "What's my engineering
               search looking like?"
               MCP responds with a natural language pipeline brief.
               "Six agents. One approval. Your pipeline is in Claude."
```

---

### Appendix D — Key Auth0 Console Setup Steps

1. **Create Application:** Single Page App → get Client ID and Secret
2. **Create API:** Audience = `https://api.headhunt.app`; enable RBAC; add permissions (`read:candidates`, `write:offers`, etc.)
3. **Enable Social Connections:** Google OAuth2 (request Gmail + Calendar scopes), Slack, Tumblr — all via Token Vault
4. **Create M2M Application:** For Management API access (Token Vault token fetching). Grant `read:user_idp_tokens` scope.
5. **Enable CIBA:** In tenant settings → Advanced → Enable CIBA flow; configure Auth0 Guardian
6. **Create FGA Store:** Via Auth0 Dashboard → FGA → New Store → import model from Appendix A
7. **Create MCP Application:** Separate application with audience `https://mcp.headhunt.app`

---

_Headhunt — v1.0 · Built for the Auth0 "Authorized to Act" Hackathon · Apr 2026_
_Stack: Next.js 15 · Vercel AI SDK · Supabase · Auth0 Token Vault + FGA + CIBA + MCP_
