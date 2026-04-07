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

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method Not Allowed' }, 405);
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ message: 'Unauthorized' }, 401);
  }

  const payload = await readJsonObject(request);
  const eventType = asString(payload.type) ?? asString(payload.eventType);
  const table = asString(payload.table);
  const record = asRecord(payload.record) ?? {};

  const normalizedType = eventType?.toUpperCase();
  if (table !== 'candidates' || normalizedType !== 'INSERT') {
    return jsonResponse(
      {
        check: 'v2_webhook_candidate_created',
        status: 'ignored',
        reason: 'Expected candidates INSERT payload.',
      },
      200,
    );
  }

  const candidateId = asString(record.id);
  const jobId = asString(record.job_id);
  const organizationId = asString(record.organization_id);

  if (!candidateId || !jobId) {
    return jsonResponse(
      {
        check: 'v2_webhook_candidate_created',
        status: 'error',
        message: 'candidate id and job id are required in webhook record.',
      },
      400,
    );
  }

  const actorUserId =
    asString(payload.actorUserId) ??
    asString(Deno.env.get('HEADHUNT_FOUNDER_USER_ID')) ??
    asString(Deno.env.get('AUTH0_FOUNDER_USER_ID'));

  try {
    const client = createAdminClient();
    const enqueued = await enqueueRun(client, {
      handlerType: 'candidate.score',
      resourceType: 'candidate',
      resourceId: candidateId,
      idempotencyKey: buildIdempotencyKey([
        'v2',
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

    const processNow = asBoolean(payload.processNow) ?? true;
    const processLimit = Math.max(1, Math.min(10, asNumber(payload.processLimit) ?? 2));
    const executeCookie =
      request.headers.get('x-automation-execute-cookie')?.trim() ||
      request.headers.get('cookie')?.trim() ||
      asString(payload.executeCookie);

    let processed: Record<string, unknown> | undefined;
    if (processNow) {
      processed = await processQueue(client, processLimit, {
        executeCookie,
      });
    }

    return jsonResponse({
      check: 'v2_webhook_candidate_created',
      status: 'success',
      event: {
        table,
        type: normalizedType,
      },
      enqueued,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'v2_webhook_candidate_created',
        status: 'error',
        message: error instanceof Error ? error.message : 'Candidate webhook enqueue failed.',
      },
      500,
    );
  }
});
