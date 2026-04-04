// @ts-nocheck
import {
  asRecord,
  asString,
  buildIdempotencyKey,
  createAdminClient,
  enqueueRun,
  isAuthorized,
  jsonResponse,
  readJsonObject,
} from '../_shared/automation-runtime.ts';

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

async function enqueueFromEvent(event: SupabaseDbEvent) {
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
        candidateId,
        jobId,
        organizationId,
        turns: 3,
        maxEvidenceChars: 9000,
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
        offerId,
        organizationId: asString(record.organization_id),
        authReqId: asString(record.ciba_auth_req_id),
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
    const enqueued = await enqueueFromEvent(event);

    return jsonResponse({
      check: 'automation_webhook',
      status: 'success',
      event: {
        table: event.table,
        type: event.type,
      },
      enqueued,
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
