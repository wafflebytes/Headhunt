// @ts-nocheck
import {
  asNumber,
  asRecord,
  asString,
  buildIdempotencyKey,
  createAdminClient,
  enqueueRun,
  isAuthorized,
  jsonResponse,
  processQueue,
  readJsonObject,
} from '../_shared/automation-runtime.ts';

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return undefined;
}

type SupabaseDbEvent = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema?: string;
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown>;
};

function parseEvent(input: Record<string, unknown>): SupabaseDbEvent | null {
  const type = asString(input.type);
  const table = asString(input.table);

  if (!type || !table) {
    return null;
  }

  if (type !== 'INSERT' && type !== 'UPDATE' && type !== 'DELETE') {
    return null;
  }

  return {
    type,
    table,
    schema: asString(input.schema),
    record: asRecord(input.record) ?? undefined,
    old_record: asRecord(input.old_record) ?? undefined,
  };
}

async function enqueueFromEvent(event: SupabaseDbEvent, actorUserId?: string) {
  const client = createAdminClient();
  const record = event.record ?? {};

  if (event.table === 'candidates' && event.type === 'INSERT') {
    const candidateId = asString(record.id);
    const jobId = asString(record.job_id);
    const organizationId = asString(record.organization_id);

    if (!candidateId || !jobId) {
      return { handled: false, reason: 'missing_candidate_or_job_id' as const };
    }

    const result = await enqueueRun(client, {
      handlerType: 'candidate.score',
      resourceType: 'candidate',
      resourceId: candidateId,
      idempotencyKey: buildIdempotencyKey([
        'webhook',
        'candidate-score',
        candidateId,
        asString(record.source_email_message_id),
      ]),
      payload: {
        agentName: 'analyst',
        candidateId,
        jobId,
        organizationId,
        actorUserId,
        turns: 1,
        maxEvidenceChars: 2500,
        automationMode: true,
      },
      maxAttempts: 6,
    });

    return {
      handled: true,
      target: 'candidate.score' as const,
      ...result,
    };
  }

  if (event.table === 'offers' && (event.type === 'INSERT' || event.type === 'UPDATE')) {
    const offerId = asString(record.id);
    const status = asString(record.status);

    if (!offerId || status !== 'awaiting_approval') {
      return { handled: false, reason: 'offer_not_pending_approval' as const };
    }

    const result = await enqueueRun(client, {
      handlerType: 'offer.clearance.poll',
      resourceType: 'offer',
      resourceId: offerId,
      idempotencyKey: buildIdempotencyKey([
        'webhook',
        'offer-clearance-poll',
        offerId,
        asString(record.ciba_auth_req_id),
      ]),
      payload: {
        agentName: 'dispatch',
        offerId,
        organizationId: asString(record.organization_id),
        authReqId: asString(record.ciba_auth_req_id),
        actorUserId,
      },
      maxAttempts: 8,
    });

    return {
      handled: true,
      target: 'offer.clearance.poll' as const,
      ...result,
    };
  }

  return { handled: false, reason: 'unsupported_table_or_event' as const };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method Not Allowed' }, 405);
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ message: 'Unauthorized' }, 401);
  }

  const payload = await readJsonObject(request);
  const event = parseEvent(payload);

  if (!event) {
    return jsonResponse(
      {
        check: 'automation_webhook',
        status: 'error',
        message: 'Invalid webhook payload.',
      },
      400,
    );
  }

  try {
    const actorUserId =
      asString(payload.actorUserId) ??
      asString(Deno.env.get('HEADHUNT_FOUNDER_USER_ID')) ??
      asString(Deno.env.get('AUTH0_FOUNDER_USER_ID'));

    const enqueued = await enqueueFromEvent(event, actorUserId);
    const processNow = asBoolean(payload.processNow) ?? false;
    const processLimit = Math.max(1, Math.min(10, asNumber(payload.processLimit) ?? 1));
    const executeCookie =
      request.headers.get('x-automation-execute-cookie')?.trim() ||
      request.headers.get('cookie')?.trim() ||
      asString(payload.executeCookie);

    let processed: Record<string, unknown> | undefined;
    if (processNow && enqueued.handled) {
      const client = createAdminClient();
      processed = await processQueue(client, processLimit, {
        executeCookie,
      });
    }

    return jsonResponse({
      check: 'automation_webhook',
      status: 'success',
      event: {
        table: event.table,
        type: event.type,
      },
      enqueued,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'automation_webhook',
        status: 'error',
        message: error instanceof Error ? error.message : 'Webhook enqueue failed.',
      },
      500,
    );
  }
});
