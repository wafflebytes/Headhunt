// @ts-nocheck
import {
  asNumber,
  asString,
  createAdminClient,
  enqueueWatchdogs,
  isAuthorized,
  jsonResponse,
  processQueue,
  readJsonObject,
} from '../_shared/automation-runtime.ts';

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

  const requestedLimit = asNumber(body.limit);
  const limit = typeof requestedLimit === 'number'
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : 20;

  const actorUserId = asString(body.actorUserId);

  const response: Record<string, unknown> = {
    check: 'automation_cron',
    status: 'success',
    job,
    limit,
  };

  try {
    const client = createAdminClient();

    if (job === 'all' || job === 'watchdogs') {
      response.watchdogs = await enqueueWatchdogs(client, { actorUserId });
    }

    if (job === 'all' || job === 'process') {
      response.processed = await processQueue(client, limit);
    }

    return jsonResponse(response, 200);
  } catch (error) {
    return jsonResponse(
      {
        check: 'automation_cron',
        status: 'error',
        message: error instanceof Error ? error.message : 'Automation cron failed.',
      },
      500,
    );
  }
});
