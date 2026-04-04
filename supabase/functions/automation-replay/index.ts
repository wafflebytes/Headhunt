// @ts-nocheck
import {
  asString,
  createAdminClient,
  isAuthorized,
  jsonResponse,
  readJsonObject,
  replayRun,
} from '../_shared/automation-runtime.ts';

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
        check: 'automation_replay',
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
          check: 'automation_replay',
          status: 'error',
          message: `Run ${runId} not found.`,
        },
        404,
      );
    }

    return jsonResponse({
      check: 'automation_replay',
      status: 'success',
      run: replayed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'automation_replay',
        status: 'error',
        message: error instanceof Error ? error.message : 'Replay failed.',
      },
      500,
    );
  }
});
