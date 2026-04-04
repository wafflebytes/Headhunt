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

async function invokeAutomationExecutor(run: AutomationRunRow): Promise<JsonObject> {
  const executeUrl = requiredEnv('AUTOMATION_EXECUTE_URL');
  const executeSecret =
    Deno.env.get('AUTOMATION_EXECUTE_SECRET')?.trim() ||
    Deno.env.get('SUPABASE_AUTOMATION_FUNCTION_SECRET')?.trim() ||
    Deno.env.get('AUTOMATION_CRON_SECRET')?.trim();

  if (!executeSecret) {
    throw new Error('Missing automation execute secret. Set AUTOMATION_EXECUTE_SECRET.');
  }

  const response = await fetch(executeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${executeSecret}`,
      'x-automation-secret': executeSecret,
    },
    body: JSON.stringify({
      handlerType: run.handler_type,
      payload: run.payload ?? {},
    }),
  });

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

export async function processQueue(client: SupabaseClient, limit: number) {
  const claimed = await claimDueRuns(client, limit);

  let completed = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const run of claimed) {
    const nowIso = new Date().toISOString();

    try {
      const result = await invokeAutomationExecutor(run);
      const status = asString(result.status);

      if (status === 'success' && !isRetryableSuccess(result)) {
        const manualReviewNeeded = shouldEscalateToManualReview(run.handler_type, result);
        const finalResult = manualReviewNeeded
          ? {
              ...result,
              manualReviewRequired: true,
              manualReviewReason: 'Automation could not safely complete booking from candidate reply.',
            }
          : result;

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
        continue;
      }

      const nextAttemptCount = run.attempt_count + 1;
      const reachedMax = nextAttemptCount >= run.max_attempts;

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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown automation error.';
      const nextAttemptCount = run.attempt_count + 1;
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
      }
    }
  }

  return {
    claimed: claimed.length,
    completed,
    retried,
    deadLettered,
  };
}
