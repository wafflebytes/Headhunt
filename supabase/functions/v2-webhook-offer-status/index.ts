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
  if (table !== 'offers' || (normalizedType !== 'INSERT' && normalizedType !== 'UPDATE')) {
    return jsonResponse(
      {
        check: 'v2_webhook_offer_status',
        status: 'ignored',
        reason: 'Expected offers INSERT/UPDATE payload.',
      },
      200,
    );
  }

  const offerId = asString(record.id);
  const offerStatus = asString(record.status);

  if (!offerId) {
    return jsonResponse(
      {
        check: 'v2_webhook_offer_status',
        status: 'error',
        message: 'offer id is required in webhook record.',
      },
      400,
    );
  }

  if (offerStatus !== 'awaiting_approval') {
    return jsonResponse(
      {
        check: 'v2_webhook_offer_status',
        status: 'ignored',
        reason: `Offer status ${offerStatus ?? 'unknown'} does not require clearance polling.`,
      },
      200,
    );
  }

  const actorUserId =
    asString(payload.actorUserId) ??
    asString(Deno.env.get('HEADHUNT_FOUNDER_USER_ID')) ??
    asString(Deno.env.get('AUTH0_FOUNDER_USER_ID'));

  try {
    const client = createAdminClient();
    const enqueued = await enqueueRun(client, {
      handlerType: 'offer.clearance.poll',
      resourceType: 'offer',
      resourceId: offerId,
      idempotencyKey: buildIdempotencyKey([
        'v2',
        'webhook',
        'offer-clearance-poll',
        offerId,
        asString(record.ciba_auth_req_id),
      ]),
      payload: {
        agentName: 'dispatch',
        offerId,
        candidateId: asString(record.candidate_id),
        jobId: asString(record.job_id),
        organizationId: asString(record.organization_id),
        authReqId: asString(record.ciba_auth_req_id),
        actorUserId,
      },
      maxAttempts: 8,
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
      check: 'v2_webhook_offer_status',
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
        check: 'v2_webhook_offer_status',
        status: 'error',
        message: error instanceof Error ? error.message : 'Offer webhook enqueue failed.',
      },
      500,
    );
  }
});
