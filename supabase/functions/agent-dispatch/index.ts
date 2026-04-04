// @ts-nocheck
import {
  asNumber,
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

  const body = await readJsonObject(request);
  const action = asString(body.action) ?? 'draft';

  const isPoll = action === 'clearance_poll';
  const isSend = action === 'send';
  const handlerType = isPoll
    ? 'offer.clearance.poll'
    : isSend
      ? 'offer.submit.clearance'
      : 'offer.draft.create';

  const offerId = asString(body.offerId);
  const candidateId = asString(body.candidateId);
  const jobId = asString(body.jobId);

  if (isPoll) {
    if (!offerId) {
      return jsonResponse(
        {
          check: 'agent_dispatch',
          status: 'error',
          message: 'offerId is required when action is clearance_poll.',
        },
        400,
      );
    }
  } else {
    if (!isSend && (!candidateId || !jobId)) {
      return jsonResponse(
        {
          check: 'agent_dispatch',
          status: 'error',
          message: 'candidateId and jobId are required when action is draft.',
        },
        400,
      );
    }

    if (isSend && !offerId && (!candidateId || !jobId)) {
      return jsonResponse(
        {
          check: 'agent_dispatch',
          status: 'error',
          message: 'Provide offerId or candidateId+jobId when action is send.',
        },
        400,
      );
    }
  }

  const payload = {
    agentName: 'dispatch',
    offerId,
    candidateId,
    jobId,
    organizationId: asString(body.organizationId),
    actorUserId: asString(body.actorUserId),
    templateId: asString(body.templateId),
    terms: typeof body.terms === 'object' && body.terms ? body.terms : undefined,
    authReqId: asString(body.authReqId),
    founderUserId: asString(body.founderUserId),
    allowSystemBypass: asBoolean(body.allowSystemBypass) ?? true,
      forceReissue: asBoolean(body.forceReissue),
      requestedExpirySeconds: asNumber(body.requestedExpirySeconds),
  };

    const useOfferResource = isPoll || (isSend && Boolean(offerId));
    const resourceType = useOfferResource ? 'offer' : 'candidate';
    const resourceId = useOfferResource ? (offerId as string) : (candidateId as string);

  const processNow = asBoolean(body.processNow) ?? true;
  const processLimit = Math.max(1, Math.min(10, asNumber(body.processNowLimit) ?? 1));
  const executeCookie =
    request.headers.get('x-automation-execute-cookie')?.trim() ||
    request.headers.get('cookie')?.trim() ||
    asString(body.executeCookie);

  try {
    const client = createAdminClient();

    const enqueued = await enqueueRun(client, {
      handlerType,
        resourceType,
        resourceId,
      idempotencyKey: buildIdempotencyKey([
        'agent',
        'dispatch',
        handlerType,
        offerId,
        candidateId,
        jobId,
        asString(body.idempotencySeed) ?? new Date().toISOString().slice(0, 16),
      ]),
      payload,
      maxAttempts: 8,
    });

    let processed: Record<string, unknown> | undefined;
    if (processNow && enqueued.inserted) {
      processed = await processQueue(client, processLimit, {
        executeCookie,
      });
    }

    return jsonResponse({
      check: 'agent_dispatch',
      status: 'success',
      agent: 'dispatch',
      handlerType,
      enqueued,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'agent_dispatch',
        status: 'error',
        message: error instanceof Error ? error.message : 'Dispatch agent failed.',
      },
      500,
    );
  }
});
