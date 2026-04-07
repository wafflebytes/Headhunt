// @ts-nocheck
import {
  buildIdempotencyKey,
  asNumber,
  asString,
  createAdminClient,
  enqueueRun,
  enqueueWatchdogs,
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

function buildQuarterHourBucket(date = new Date()): string {
  const next = new Date(date);
  const roundedMinutes = Math.floor(next.getUTCMinutes() / 15) * 15;

  next.setUTCMinutes(roundedMinutes, 0, 0);
  return next.toISOString().slice(0, 16);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method Not Allowed' }, 405);
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ message: 'Unauthorized' }, 401);
  }

  const body = await readJsonObject(request);
  const requestedJob = asString(body.job);
  const job = requestedJob === 'watchdogs' || requestedJob === 'process' || requestedJob === 'all'
    ? requestedJob
    : 'all';

  const autoIntakeEnabled =
    asBoolean(body.autoIntakeEnabled) ??
    asBoolean(Deno.env.get('AUTOMATION_AUTO_INTAKE_ENABLED')) ??
    true;

  const intakeQuery =
    asString(body.intakeQuery) ??
    Deno.env.get('AUTOMATION_INTAKE_QUERY')?.trim() ??
    'in:inbox newer_than:14d -category:promotions -category:social -subject:newsletter -subject:digest -subject:unsubscribe';
  const intakeMaxResults = Math.max(1, Math.min(25, asNumber(body.intakeMaxResults) ?? 20));
  const intakeProcessLimit = Math.max(1, Math.min(10, asNumber(body.intakeProcessLimit) ?? 8));
  const intakeCandidateLikeOnly = asBoolean(body.intakeCandidateLikeOnly) ?? true;
  const intakeIncludeBody = asBoolean(body.intakeIncludeBody) ?? true;
  const intakeGenerateIntel = asBoolean(body.intakeGenerateIntel) ?? true;
  const intakeOrganizationId = asString(body.organizationId) ?? asString(body.intakeOrganizationId);
  const intakeJobId = asString(body.jobId) ?? asString(body.intakeJobId);
  const intakeBucket = asString(body.intakeBucket) ?? buildQuarterHourBucket();

  const executeCookie =
    request.headers.get('x-automation-execute-cookie')?.trim() ||
    request.headers.get('cookie')?.trim() ||
    asString(body.executeCookie);

  const requestedLimit = asNumber(body.limit);
  const limit = typeof requestedLimit === 'number'
    ? Math.max(1, Math.min(25, Math.floor(requestedLimit)))
    : 6;

  const actorUserId =
    asString(body.actorUserId) ??
    Deno.env.get('HEADHUNT_FOUNDER_USER_ID')?.trim() ??
    Deno.env.get('AUTH0_FOUNDER_USER_ID')?.trim();
  const tokenVaultLoginHint =
    asString(body.intakeTokenVaultLoginHint) ??
    asString(body.tokenVaultLoginHint) ??
    asString(body.loginHint) ??
    Deno.env.get('AUTH0_TOKEN_VAULT_LOGIN_HINT')?.trim();

  const response: Record<string, unknown> = {
    check: 'v2_orchestrator_cron',
    status: 'success',
    architecture: 'v2',
    job,
    limit,
    autoIntakeEnabled,
    intakeBucket,
  };

  try {
    const client = createAdminClient();

    if (job === 'all' || job === 'watchdogs') {
      response.watchdogs = await enqueueWatchdogs(client, { actorUserId });

      if (autoIntakeEnabled) {
        response.intake = await enqueueRun(client, {
          handlerType: 'intake.scan',
          resourceType: 'automation',
          resourceId: 'gmail_inbox',
          idempotencyKey: buildIdempotencyKey([
            'v2',
            'intake-scan',
            intakeOrganizationId,
            intakeJobId,
            intakeBucket,
          ]),
          payload: {
            agentName: 'intercept',
            organizationId: intakeOrganizationId,
            jobId: intakeJobId,
            actorUserId,
            tokenVaultLoginHint,
            query: intakeQuery,
            maxResults: intakeMaxResults,
            processLimit: intakeProcessLimit,
            candidateLikeOnly: intakeCandidateLikeOnly,
            includeBody: intakeIncludeBody,
            generateIntel: intakeGenerateIntel,
          },
          maxAttempts: 6,
        });
      }
    }

    if (job === 'all' || job === 'process') {
      response.processed = await processQueue(client, limit, {
        executeCookie,
      });
    }

    return jsonResponse(response, 200);
  } catch (error) {
    return jsonResponse(
      {
        check: 'v2_orchestrator_cron',
        status: 'error',
        architecture: 'v2',
        message: error instanceof Error ? error.message : 'Automation cron failed.',
      },
      500,
    );
  }
});
