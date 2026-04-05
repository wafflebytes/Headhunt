// @ts-nocheck
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type JsonObject = Record<string, unknown>;

type AutomationRunRow = {
  id: string;
  handler_type: string;
  resource_type: string;
  resource_id: string;
  payload: JsonObject | null;
  attempt_count: number;
  max_attempts: number;
};

const AGENT_NAMES = ['intercept', 'triage', 'analyst', 'liaison', 'dispatch'] as const;
type AgentName = typeof AGENT_NAMES[number];

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

export function asRecord(value: unknown): JsonObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return null;
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return undefined;
}

function normalizeAgentName(value: unknown): AgentName | undefined {
  const raw = asString(value)?.toLowerCase();
  if (!raw) {
    return undefined;
  }

  if (AGENT_NAMES.includes(raw as AgentName)) {
    return raw as AgentName;
  }

  return undefined;
}

function inferAgentFromHandler(handlerType: string): AgentName {
  if (handlerType === 'intake.scan') {
    return 'intercept';
  }

  if (handlerType === 'candidate.score') {
    return 'analyst';
  }

  if (handlerType === 'scheduling.request.send' || handlerType === 'scheduling.reply.parse_book') {
    return 'liaison';
  }

  if (handlerType.startsWith('offer.')) {
    return 'dispatch';
  }

  if (handlerType.startsWith('interview.')) {
    return 'liaison';
  }

  return 'triage';
}

function resolveRunAgentName(run: AutomationRunRow): AgentName {
  const payload = asRecord(run.payload) ?? {};
  return normalizeAgentName(payload.agentName) ?? inferAgentFromHandler(run.handler_type);
}

function withAgentName(payload: JsonObject, fallbackAgent: AgentName): JsonObject {
  return {
    ...payload,
    agentName: normalizeAgentName(payload.agentName) ?? fallbackAgent,
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

export function isAuthorized(request: Request): boolean {
  const configuredSecret =
    Deno.env.get('SUPABASE_AUTOMATION_FUNCTION_SECRET')?.trim() ||
    Deno.env.get('AUTOMATION_CRON_SECRET')?.trim();

  if (!configuredSecret) {
    return false;
  }

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-automation-secret')?.trim();
  return bearer === configuredSecret || headerSecret === configuredSecret;
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export function buildIdempotencyKey(parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(':')
    .slice(0, 240);
}

export function createAdminClient() {
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function rpcSingleRow<T extends JsonObject>(
  client: SupabaseClient,
  fn: string,
  args: JsonObject,
): Promise<T | null> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return asRecord(data[0]) as T | null;
}

export async function enqueueRun(
  client: SupabaseClient,
  input: {
    handlerType: string;
    resourceType: string;
    resourceId: string;
    idempotencyKey: string;
    payload: JsonObject;
    nextAttemptAt?: string;
    maxAttempts?: number;
    replayedFromRunId?: string;
  },
) {
  const row = await rpcSingleRow<{ inserted?: boolean; run_id?: string }>(client, 'automation_enqueue_run', {
    p_handler_type: input.handlerType,
    p_resource_type: input.resourceType,
    p_resource_id: input.resourceId,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload,
    p_next_attempt_at: input.nextAttemptAt ?? new Date().toISOString(),
    p_max_attempts: input.maxAttempts ?? 8,
    p_replayed_from_run_id: input.replayedFromRunId ?? null,
  });

  return {
    inserted: row?.inserted === true,
    runId: asString(row?.run_id) ?? null,
  };
}

export async function replayRun(client: SupabaseClient, runId: string) {
  const row = await rpcSingleRow<{ id?: string; status?: string }>(client, 'automation_replay_run', {
    p_run_id: runId,
  });

  if (!row?.id || !row?.status) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
  };
}

export async function enqueueWatchdogs(
  client: SupabaseClient,
  input?: {
    actorUserId?: string;
    replyStaleHours?: number;
    transcriptStaleHours?: number;
    offerPendingHours?: number;
  },
) {
  const row = await rpcSingleRow<{ enqueued?: number }>(client, 'automation_enqueue_watchdogs', {
    p_actor_user_id: input?.actorUserId ?? null,
    p_reply_stale_hours: input?.replyStaleHours ?? 48,
    p_transcript_stale_hours: input?.transcriptStaleHours ?? 2,
    p_offer_pending_hours: input?.offerPendingHours ?? 24,
  });

  return {
    enqueued: asNumber(row?.enqueued) ?? 0,
  };
}

async function claimDueRuns(client: SupabaseClient, limit: number): Promise<AutomationRunRow[]> {
  const { data, error } = await client.rpc('automation_claim_due_runs', {
    p_limit: Math.max(1, Math.min(100, Math.floor(limit))),
  });

  if (error) {
    throw new Error(`automation_claim_due_runs failed: ${error.message}`);
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => asRecord(row))
    .filter((row): row is JsonObject => Boolean(row))
    .map((row) => ({
      id: asString(row.id) ?? '',
      handler_type: asString(row.handler_type) ?? '',
      resource_type: asString(row.resource_type) ?? '',
      resource_id: asString(row.resource_id) ?? '',
      payload: asRecord(row.payload),
      attempt_count: asNumber(row.attempt_count) ?? 0,
      max_attempts: asNumber(row.max_attempts) ?? 8,
    }))
    .filter((row) => row.id && row.handler_type);
}

function computeRetryDelayMs(attemptNumber: number) {
  const baseMs = 30_000;
  const cappedExponent = Math.min(8, Math.max(0, attemptNumber - 1));
  const jitter = Math.floor(Math.random() * 3_000);
  return baseMs * Math.pow(2, cappedExponent) + jitter;
}

function isRetryableSuccess(result: JsonObject): boolean {
  const check = asString(result.check);
  const mode = asString(result.mode);
  return check === 'poll_offer_clearance' && mode === 'awaiting_clearance';
}

function shouldEscalateToManualReview(handlerType: string, result: JsonObject): boolean {
  if (handlerType !== 'scheduling.reply.parse_book') {
    return false;
  }

  const check = asString(result.check);
  const mode = asString(result.mode);
  const status = asString(result.status);

  if (status === 'error') {
    return true;
  }

  if (check === 'run_final_schedule_flow' && mode !== 'scheduled') {
    return true;
  }

  return false;
}

function shouldDeadLetterWithoutRetry(run: AutomationRunRow, result: JsonObject): boolean {
  const status = asString(result.status);
  if (status !== 'error') {
    return false;
  }

  const message = (asString(result.message) ?? '').toLowerCase();

  // Token Vault consent/scope errors require user re-authorization, so retries will not self-heal.
  if (message.includes('authorization required to access the token vault')) {
    return true;
  }

  if (message.includes('missing scopes:')) {
    return true;
  }

  if (run.handler_type === 'offer.submit.clearance' && message.includes('offer not found')) {
    return true;
  }

  if (run.handler_type === 'offer.submit.clearance') {
    if (message.includes('no eligible notification channels were found')) {
      return true;
    }

    if (message.includes('iss within login_hint')) {
      return true;
    }

    if (message.includes('binding_message')) {
      return true;
    }

    if (message.includes('service not found')) {
      return true;
    }
  }

  if (run.handler_type === 'interview.transcript.debrief.slack') {
    if (message.includes('channel_not_found')) {
      return true;
    }

    if (message.includes('not_in_channel')) {
      return true;
    }

    if (message.includes('not in the #')) {
      return true;
    }

    if (message.includes('bot is not in')) {
      return true;
    }
  }

  if (run.handler_type === 'interview.transcript.fetch') {
    if (message.includes('candidate ') && message.includes(' not found')) {
      return true;
    }

    if (message.includes('job ') && message.includes(' not found')) {
      return true;
    }

    if (message.includes('no candidate visibility access')) {
      return true;
    }

    if (message.includes('insufficient_scope: this endpoint is not available for third-party oauth tokens')) {
      return true;
    }
  }

  return false;
}

function resolveDefaultActorUserId() {
  return (
    Deno.env.get('HEADHUNT_FOUNDER_USER_ID')?.trim() ||
    Deno.env.get('AUTH0_FOUNDER_USER_ID')?.trim() ||
    undefined
  );
}

function compactObject(value: JsonObject): JsonObject {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries);
}

function shouldAutoScheduleFromScore(result: JsonObject): boolean {
  const consensus = asRecord(result.consensus);
  const recommendation = asString(consensus?.recommendation);

  if (recommendation) {
    return recommendation === 'Strong Hire' || recommendation === 'Hire' || recommendation === 'Leaning Hire';
  }

  const finalScore = asNumber(consensus?.finalScore);
  if (typeof finalScore === 'number') {
    return finalScore >= 65;
  }

  // Preserve forward progress for legacy score payloads that omit consensus.
  return true;
}

async function enqueuePostSuccessFollowUps(
  client: SupabaseClient,
  run: AutomationRunRow,
  result: JsonObject,
): Promise<JsonObject[]> {
  const payload = asRecord(run.payload) ?? {};
  const followUps: JsonObject[] = [];

  if (run.handler_type === 'candidate.score' && shouldAutoScheduleFromScore(result)) {
    const candidateId = asString(result.candidateId) ?? asString(payload.candidateId);
    const jobId = asString(result.jobId) ?? asString(payload.jobId);

    if (candidateId && jobId) {
      const organizationId = asString(result.organizationId) ?? asString(payload.organizationId);
      const actorUserId = asString(payload.actorUserId) ?? resolveDefaultActorUserId();
      const idempotencyKey = buildIdempotencyKey(['chain', 'candidate-score', 'schedule-request', candidateId, jobId]);

      const schedulingPayload = compactObject({
        candidateId,
        jobId,
        organizationId,
        actorUserId,
        agentName: 'liaison',
        sendMode: asString(payload.schedulingSendMode) ?? 'send',
        timezone: asString(payload.timezone) ?? 'America/Los_Angeles',
        durationMinutes: asNumber(payload.durationMinutes) ?? 30,
        targetDayCount: asNumber(payload.targetDayCount) ?? 3,
        slotsPerDay: asNumber(payload.slotsPerDay) ?? 1,
        maxSlotsToEmail: asNumber(payload.maxSlotsToEmail) ?? 3,
        eventTypeSlug: asString(payload.eventTypeSlug) ?? Deno.env.get('CAL_INTERVIEW_EVENT_TYPE_SLUG')?.trim(),
        username: asString(payload.username) ?? Deno.env.get('CAL_PUBLIC_USERNAME')?.trim(),
        teamSlug: asString(payload.teamSlug) ?? Deno.env.get('CAL_PUBLIC_TEAM_SLUG')?.trim(),
        organizationSlug: asString(payload.organizationSlug) ?? Deno.env.get('CAL_PUBLIC_ORGANIZATION_SLUG')?.trim(),
      });

      const enqueueResult = await enqueueRun(client, {
        handlerType: 'scheduling.request.send',
        resourceType: 'candidate',
        resourceId: candidateId,
        idempotencyKey,
        payload: schedulingPayload,
        maxAttempts: 6,
      });

      followUps.push({
        sourceHandler: run.handler_type,
        handlerType: 'scheduling.request.send',
        resourceType: 'candidate',
        resourceId: candidateId,
        idempotencyKey,
        inserted: enqueueResult.inserted,
        runId: enqueueResult.runId,
      });
    }
  }

  if (run.handler_type === 'scheduling.reply.parse_book' && asString(result.mode) === 'scheduled') {
    const candidateId = asString(result.candidateId) ?? asString(payload.candidateId);
    const jobId = asString(result.jobId) ?? asString(payload.jobId);

    if (candidateId && jobId) {
      const organizationId = asString(result.organizationId) ?? asString(payload.organizationId);
      const actorUserId = asString(payload.actorUserId) ?? resolveDefaultActorUserId();
      const templateId = asString(payload.offerTemplateId) ?? asString(payload.templateId);
      const terms = asRecord(payload.offerTerms) ?? asRecord(payload.terms) ?? {};
      const resultEvent = asRecord(result.event);
      const scheduleFingerprint =
        asString(result.interviewId) ??
        asString(resultEvent.bookingUid) ??
        asString(resultEvent.startISO) ??
        asString(resultEvent.endISO);
      const idempotencyKey = buildIdempotencyKey([
        'chain',
        'interview-scheduled',
        'offer-draft',
        candidateId,
        jobId,
        scheduleFingerprint,
      ]);

      const offerPayload = compactObject({
        candidateId,
        jobId,
        organizationId,
        actorUserId,
        agentName: 'dispatch',
        autoSubmitOffer: true,
        templateId,
        terms,
      });

      const enqueueResult = await enqueueRun(client, {
        handlerType: 'offer.draft.create',
        resourceType: 'candidate',
        resourceId: candidateId,
        idempotencyKey,
        payload: offerPayload,
        maxAttempts: 6,
      });

      followUps.push({
        sourceHandler: run.handler_type,
        handlerType: 'offer.draft.create',
        resourceType: 'candidate',
        resourceId: candidateId,
        idempotencyKey,
        inserted: enqueueResult.inserted,
        runId: enqueueResult.runId,
      });
    }
  }

  if (
    run.handler_type === 'offer.draft.create' &&
    asString(result.status) === 'success' &&
    asBoolean(payload.autoSubmitOffer) === true
  ) {
    const offerId = asString(result.offerId) ?? asString(payload.offerId);
    const candidateId = asString(result.candidateId) ?? asString(payload.candidateId);
    const jobId = asString(result.jobId) ?? asString(payload.jobId);

    if (offerId && candidateId && jobId) {
      const organizationId = asString(payload.organizationId);
      const actorUserId = asString(payload.actorUserId) ?? resolveDefaultActorUserId();
      const founderUserId = asString(payload.founderUserId) ?? resolveDefaultActorUserId();
      const idempotencyKey = buildIdempotencyKey(['chain', 'offer-draft', 'submit', offerId]);

      const submitPayload = compactObject({
        offerId,
        candidateId,
        jobId,
        organizationId,
        actorUserId,
        founderUserId,
        allowSystemBypass: true,
        agentName: 'dispatch',
      });

      const enqueueResult = await enqueueRun(client, {
        handlerType: 'offer.submit.clearance',
        resourceType: 'offer',
        resourceId: offerId,
        idempotencyKey,
        payload: submitPayload,
        maxAttempts: 6,
      });

      followUps.push({
        sourceHandler: run.handler_type,
        handlerType: 'offer.submit.clearance',
        resourceType: 'offer',
        resourceId: offerId,
        idempotencyKey,
        inserted: enqueueResult.inserted,
        runId: enqueueResult.runId,
      });
    }
  }

  if (run.handler_type === 'offer.submit.clearance' && asString(result.mode) === 'awaiting_clearance') {
    const offerId = asString(result.offerId) ?? asString(payload.offerId);
    const candidateId = asString(result.candidateId) ?? asString(payload.candidateId);
    const jobId = asString(result.jobId) ?? asString(payload.jobId);

    if (offerId) {
      const organizationId = asString(payload.organizationId);
      const actorUserId = asString(payload.actorUserId) ?? resolveDefaultActorUserId();
      const founderUserId = asString(payload.founderUserId) ?? resolveDefaultActorUserId();
      const authReqId = asString(result.cibaAuthReqId) ?? asString(payload.authReqId);
      const idempotencyKey = buildIdempotencyKey(['chain', 'offer-clearance', 'poll', offerId, authReqId]);

      const pollPayload = compactObject({
        offerId,
        candidateId,
        jobId,
        organizationId,
        authReqId,
        actorUserId,
        founderUserId,
        allowSystemBypass: true,
        agentName: 'dispatch',
      });

      const enqueueResult = await enqueueRun(client, {
        handlerType: 'offer.clearance.poll',
        resourceType: 'offer',
        resourceId: offerId,
        idempotencyKey,
        payload: pollPayload,
        maxAttempts: 8,
      });

      followUps.push({
        sourceHandler: run.handler_type,
        handlerType: 'offer.clearance.poll',
        resourceType: 'offer',
        resourceId: offerId,
        idempotencyKey,
        inserted: enqueueResult.inserted,
        runId: enqueueResult.runId,
      });
    }
  }

  if (run.handler_type === 'interview.transcript.fetch' && asString(result.status) === 'success') {
    const candidateId = asString(result.candidateId) ?? asString(payload.candidateId);
    const jobId = asString(result.jobId) ?? asString(payload.jobId);
    const summary = asRecord(result.summary);

    if (candidateId && summary) {
      const organizationId = asString(result.organizationId) ?? asString(payload.organizationId);
      const actorUserId = asString(payload.actorUserId) ?? resolveDefaultActorUserId();
      const bookingUid = asString(result.bookingUid) ?? asString(payload.bookingUid);
      const interviewId = asString(result.interviewId) ?? asString(payload.interviewId);
      const idempotencyKey = buildIdempotencyKey([
        'chain',
        'interview-transcript',
        'slack-digest',
        candidateId,
        jobId,
        bookingUid,
        interviewId,
      ]);

      const digestPayload = compactObject({
        candidateId,
        jobId,
        organizationId,
        actorUserId,
        bookingUid,
        interviewId,
        source: asString(result.source),
        summary,
        transcriptResult: result,
        transcriptStats: asRecord(result.transcriptStats),
        driveFile: asRecord(result.driveFile),
        slackChannel:
          asString(payload.slackChannel) ??
          Deno.env.get('HEADHUNT_TRANSCRIPT_SLACK_CHANNEL')?.trim() ??
          'new-channel',
        jobRequirements: Array.isArray(payload.jobRequirements)
          ? payload.jobRequirements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : undefined,
      });

      const enqueueResult = await enqueueRun(client, {
        handlerType: 'interview.transcript.debrief.slack',
        resourceType: 'candidate',
        resourceId: candidateId,
        idempotencyKey,
        payload: digestPayload,
        maxAttempts: 6,
      });

      followUps.push({
        sourceHandler: run.handler_type,
        handlerType: 'interview.transcript.debrief.slack',
        resourceType: 'candidate',
        resourceId: candidateId,
        idempotencyKey,
        inserted: enqueueResult.inserted,
        runId: enqueueResult.runId,
      });
    }
  }

  return followUps;
}

function resolveAutomationExecuteUrl() {
  const configured = requiredEnv('AUTOMATION_EXECUTE_URL').trim();

  try {
    const parsed = new URL(configured);
    // Guard against stale local-only secrets in cloud runtime.
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return 'https://headhunt-one.vercel.app/api/automation/execute';
    }
  } catch {
    // Keep original error behavior if URL parsing fails later.
  }

  return configured;
}

function resolveExecuteTimeoutMs() {
  const raw = Deno.env.get('AUTOMATION_EXECUTE_TIMEOUT_MS')?.trim();
  if (!raw) {
    return 12_000;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return 12_000;
  }

  return Math.min(parsed, 60_000);
}

async function invokeAutomationExecutor(
  run: AutomationRunRow,
  executeCookieOverride?: string,
): Promise<JsonObject> {
  const executeUrl = resolveAutomationExecuteUrl();
  const executeSecret =
    Deno.env.get('AUTOMATION_EXECUTE_SECRET')?.trim() ||
    Deno.env.get('SUPABASE_AUTOMATION_FUNCTION_SECRET')?.trim() ||
    Deno.env.get('AUTOMATION_CRON_SECRET')?.trim();
  const executeCookie =
    executeCookieOverride?.trim() ||
    Deno.env.get('AUTOMATION_EXECUTE_COOKIE')?.trim() ||
    '';
  const timeoutMs = resolveExecuteTimeoutMs();

  if (!executeSecret) {
    throw new Error('Missing automation execute secret. Set AUTOMATION_EXECUTE_SECRET.');
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${executeSecret}`,
    'x-automation-secret': executeSecret,
  };

  if (executeCookie) {
    headers.cookie = executeCookie;
  }

  let response: Response;
  try {
    response = await fetch(executeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        handlerType: run.handler_type,
        payload: run.payload ?? {},
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Automation execute timed out after ${timeoutMs}ms for handler ${run.handler_type}.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const raw = await response.text();
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  const payload = asRecord(parsed) ?? {};

  if (!response.ok) {
    const message = asString(payload.message) ?? `Automation execute endpoint failed with status ${response.status}.`;
    throw new Error(message);
  }

  const result = asRecord(payload.result);
  if (!result) {
    throw new Error('Automation execute endpoint returned invalid result payload.');
  }

  return result;
}

async function updateRun(
  client: SupabaseClient,
  runId: string,
  updates: JsonObject,
) {
  const { error } = await client
    .from('automation_runs')
    .update(updates)
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to update automation run ${runId}: ${error.message}`);
  }
}

async function insertManualReviewAudit(
  client: SupabaseClient,
  run: AutomationRunRow,
  result: JsonObject,
) {
  const payloadOrgId = asString(asRecord(run.payload)?.organizationId) ?? null;

  const { error } = await client.from('audit_logs').insert({
    organization_id: payloadOrgId,
    actor_type: 'system',
    actor_id: 'automation.manual_review',
    actor_display_name: 'Automation Worker',
    action: 'automation.manual_review.required',
    resource_type: run.resource_type,
    resource_id: run.resource_id,
    metadata: {
      handlerType: run.handler_type,
      runId: run.id,
      result,
    },
    result: 'pending',
  });

  if (error) {
    throw new Error(`Failed to insert manual review audit log: ${error.message}`);
  }
}

export async function processQueue(
  client: SupabaseClient,
  limit: number,
  options?: {
    executeCookie?: string;
  },
) {
  let totalClaimed = 0;
  let remainingClaims = Math.max(1, limit);
  let completed = 0;
  let retried = 0;
  let deadLettered = 0;
  const agents: Record<string, { claimed: number; completed: number; retried: number; deadLettered: number }> = {};

  const bumpAgentMetric = (
    agentName: AgentName,
    key: 'claimed' | 'completed' | 'retried' | 'deadLettered',
  ) => {
    const current = agents[agentName] ?? {
      claimed: 0,
      completed: 0,
      retried: 0,
      deadLettered: 0,
    };
    current[key] += 1;
    agents[agentName] = current;
  };

  while (remainingClaims > 0) {
    const claimed = await claimDueRuns(client, remainingClaims);
    if (claimed.length === 0) {
      break;
    }

    totalClaimed += claimed.length;
    remainingClaims -= claimed.length;

    for (const run of claimed) {
      const agentName = resolveRunAgentName(run);
      bumpAgentMetric(agentName, 'claimed');
      const nowIso = new Date().toISOString();

      try {
        const result = await invokeAutomationExecutor(run, options?.executeCookie);
        const status = asString(result.status);

        if (status === 'success' && !isRetryableSuccess(result)) {
          const manualReviewNeeded = shouldEscalateToManualReview(run.handler_type, result);
          const baseResult = manualReviewNeeded
            ? {
                ...result,
                agentName,
                manualReviewRequired: true,
                manualReviewReason: 'Automation could not safely complete booking from candidate reply.',
              }
            : withAgentName(result, agentName);

          const followUps = await enqueuePostSuccessFollowUps(client, run, baseResult);
          const finalResult = followUps.length > 0
            ? {
                ...baseResult,
                followUps,
              }
            : baseResult;

          await updateRun(client, run.id, {
            status: 'completed',
            result: finalResult,
            finished_at: nowIso,
            updated_at: nowIso,
            last_error: null,
            last_error_at: null,
          });

          if (manualReviewNeeded) {
            await insertManualReviewAudit(client, run, finalResult);
          }

          completed += 1;
          bumpAgentMetric(agentName, 'completed');
          continue;
        }

        const nextAttemptCount = run.attempt_count + 1;
        const reachedMax = shouldDeadLetterWithoutRetry(run, result) || nextAttemptCount >= run.max_attempts;

        if (reachedMax) {
          await updateRun(client, run.id, {
            status: 'dead_letter',
            result,
            attempt_count: nextAttemptCount,
            finished_at: nowIso,
            updated_at: nowIso,
            last_error: asString(result.message) ?? 'Automation run exhausted retry attempts.',
            last_error_at: nowIso,
          });

          deadLettered += 1;
          bumpAgentMetric(agentName, 'deadLettered');
        } else {
          await updateRun(client, run.id, {
            status: 'retrying',
            result,
            attempt_count: nextAttemptCount,
            next_attempt_at: new Date(Date.now() + computeRetryDelayMs(nextAttemptCount)).toISOString(),
            updated_at: nowIso,
            last_error: asString(result.message) ?? 'Retrying due to non-terminal automation response.',
            last_error_at: nowIso,
          });

          retried += 1;
          bumpAgentMetric(agentName, 'retried');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown automation error.';
        const nextAttemptCount = run.attempt_count + 1;
        const terminalAuthError = shouldDeadLetterWithoutRetry(run, {
          status: 'error',
          message,
        });

        if (terminalAuthError) {
          await updateRun(client, run.id, {
            status: 'dead_letter',
            attempt_count: nextAttemptCount,
            finished_at: nowIso,
            updated_at: nowIso,
            last_error: message,
            last_error_at: nowIso,
          });

          deadLettered += 1;
          bumpAgentMetric(agentName, 'deadLettered');
          continue;
        }

        const reachedMax = nextAttemptCount >= run.max_attempts;

        if (reachedMax) {
          await updateRun(client, run.id, {
            status: 'dead_letter',
            attempt_count: nextAttemptCount,
            finished_at: nowIso,
            updated_at: nowIso,
            last_error: message,
            last_error_at: nowIso,
          });

          deadLettered += 1;
          bumpAgentMetric(agentName, 'deadLettered');
        } else {
          await updateRun(client, run.id, {
            status: 'retrying',
            attempt_count: nextAttemptCount,
            next_attempt_at: new Date(Date.now() + computeRetryDelayMs(nextAttemptCount)).toISOString(),
            updated_at: nowIso,
            last_error: message,
            last_error_at: nowIso,
          });

          retried += 1;
          bumpAgentMetric(agentName, 'retried');
        }
      }
    }
  }

  return {
    claimed: totalClaimed,
    completed,
    retried,
    deadLettered,
    agents,
  };
}
