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

  const query =
    asString(body.query) ??
    Deno.env.get('AUTOMATION_INTAKE_QUERY')?.trim() ??
    'in:inbox newer_than:14d -category:promotions -category:social -subject:newsletter -subject:digest -subject:unsubscribe';

  const payload = {
    agentName: 'triage',
    organizationId: asString(body.organizationId) ?? asString(body.intakeOrganizationId),
    jobId: asString(body.jobId) ?? asString(body.intakeJobId),
    query,
    maxResults: Math.max(1, Math.min(25, asNumber(body.maxResults) ?? 15)),
    processLimit: Math.max(1, Math.min(10, asNumber(body.processLimit) ?? 6)),
    candidateLikeOnly: asBoolean(body.candidateLikeOnly) ?? false,
    includeBody: asBoolean(body.includeBody) ?? true,
    generateIntel: asBoolean(body.generateIntel) ?? false,
  };

  const processNow = asBoolean(body.processNow) ?? true;
  const processLimit = Math.max(1, Math.min(10, asNumber(body.processNowLimit) ?? 1));
  const executeCookie =
    request.headers.get('x-automation-execute-cookie')?.trim() ||
    request.headers.get('cookie')?.trim() ||
    asString(body.executeCookie);

  try {
    const client = createAdminClient();
    const bucket = new Date().toISOString().slice(0, 16);

    const enqueued = await enqueueRun(client, {
      handlerType: 'intake.scan',
      resourceType: 'automation',
      resourceId: 'gmail_inbox',
      idempotencyKey: buildIdempotencyKey([
        'agent',
        'triage',
        payload.organizationId,
        payload.jobId,
        bucket,
      ]),
      payload,
      maxAttempts: 6,
    });

    let processed: Record<string, unknown> | undefined;
    if (processNow && enqueued.inserted) {
      processed = await processQueue(client, processLimit, {
        executeCookie,
      });
    }

    return jsonResponse({
      check: 'agent_triage',
      status: 'success',
      agent: 'triage',
      enqueued,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'agent_triage',
        status: 'error',
        message: error instanceof Error ? error.message : 'Triage agent failed.',
      },
      500,
    );
  }
});
