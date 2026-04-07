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
  const candidateId = asString(body.candidateId);
  const jobId = asString(body.jobId);

  if (!candidateId || !jobId) {
    return jsonResponse(
      {
        check: 'agent_analyst',
        status: 'error',
        message: 'candidateId and jobId are required.',
      },
      400,
    );
  }

  const payload = {
    agentName: 'analyst',
    candidateId,
    jobId,
    organizationId: asString(body.organizationId),
    actorUserId: asString(body.actorUserId),
    emailText: asString(body.emailText),
    resumeText: asString(body.resumeText),
    externalContext: asString(body.externalContext),
    requirements: Array.isArray(body.requirements) ? body.requirements : undefined,
    turns: Math.max(1, Math.min(3, asNumber(body.turns) ?? 1)),
    maxEvidenceChars: Math.max(2000, Math.min(24000, asNumber(body.maxEvidenceChars) ?? 2500)),
    automationMode: asBoolean(body.automationMode) ?? true,
  };

  const processNow = asBoolean(body.processNow) ?? true;
  const processLimit = Math.max(1, Math.min(10, asNumber(body.processNowLimit) ?? 1));
  const executeCookie =
    request.headers.get('x-automation-execute-cookie')?.trim() ||
    request.headers.get('cookie')?.trim() ||
    asString(body.executeCookie);

  try {
    const client = createAdminClient();

    const enqueued = await enqueueRun(client, {
      handlerType: 'candidate.score',
      resourceType: 'candidate',
      resourceId: candidateId,
      idempotencyKey: buildIdempotencyKey([
        'v2',
        'agent',
        'analyst',
        candidateId,
        jobId,
        asString(body.idempotencySeed) ?? new Date().toISOString().slice(0, 16),
      ]),
      payload,
      maxAttempts: 6,
    });

    let processed: Record<string, unknown> | undefined;
    if (processNow) {
      processed = await processQueue(client, processLimit, {
        executeCookie,
      });
    }

    return jsonResponse({
      check: 'v2_agent_analyst',
      status: 'success',
      architecture: 'v2',
      agent: 'analyst',
      enqueued,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'v2_agent_analyst',
        status: 'error',
        message: error instanceof Error ? error.message : 'Analyst agent failed.',
      },
      500,
    );
  }
});
