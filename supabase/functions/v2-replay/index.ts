// @ts-nocheck
import {
  asNumber,
  asString,
  createAdminClient,
  isAuthorized,
  jsonResponse,
  processQueue,
  readJsonObject,
  replayRun,
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
  const runId = asString(payload.runId);

  if (!runId) {
    return jsonResponse(
      {
          check: 'v2_replay',
        status: 'error',
        message: 'runId is required.',
      },
      400,
    );
  }

  try {
    const client = createAdminClient();
    const replayed = await replayRun(client, runId);

    if (!replayed) {
      return jsonResponse(
        {
          check: 'v2_replay',
          status: 'error',
          message: `Run ${runId} not found.`,
        },
        404,
      );
    }

    const processNow = asBoolean(payload.processNow) ?? true;
    const processLimit = Math.max(1, Math.min(10, asNumber(payload.processLimit) ?? 1));
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
      check: 'v2_replay',
      status: 'success',
      architecture: 'v2',
      run: replayed,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'v2_replay',
        status: 'error',
        message: error instanceof Error ? error.message : 'Replay failed.',
      },
      500,
    );
  }
});
