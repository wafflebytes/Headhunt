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
  const bookingUid = asString(body.bookingUid);
  const mode = asString(body.mode) ?? 'request';
  const hasDriveTarget =
    Boolean(asString(body.driveFileId)) ||
    Boolean(asString(body.driveQuery)) ||
    Boolean(asString(body.driveFolderId)) ||
    Boolean(asString(body.driveFolderName));

  if (mode === 'transcript') {
    if (!bookingUid && !hasDriveTarget) {
      return jsonResponse(
        {
          check: 'agent_liaison',
          status: 'error',
          message: 'bookingUid or a Drive target (driveFileId/driveQuery/driveFolderId/driveFolderName) is required for transcript mode.',
        },
        400,
      );
    }
  } else if (!candidateId || !jobId) {
    return jsonResponse(
      {
        check: 'agent_liaison',
        status: 'error',
        message: 'candidateId and jobId are required.',
      },
      400,
    );
  }

  const handlerType =
    mode === 'book'
      ? 'scheduling.reply.parse_book'
      : mode === 'transcript'
        ? 'interview.transcript.fetch'
        : 'scheduling.request.send';

  const payload =
    mode === 'transcript'
      ? {
        agentName: 'liaison',
        candidateId,
        jobId,
        organizationId: asString(body.organizationId),
        actorUserId: asString(body.actorUserId),
        bookingUid,
        interviewId: asString(body.interviewId),
        driveFileId: asString(body.driveFileId),
        driveQuery: asString(body.driveQuery),
        driveFolderId: asString(body.driveFolderId),
        driveFolderName: asString(body.driveFolderName),
        slackChannel: asString(body.slackChannel) ?? 'new-channel',
        maxTranscriptChars: Math.max(2000, Math.min(120000, asNumber(body.maxTranscriptChars) ?? 28000)),
        jobRequirements: Array.isArray(body.jobRequirements)
          ? body.jobRequirements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : undefined,
      }
      : {
        agentName: 'liaison',
        candidateId,
        jobId,
        organizationId: asString(body.organizationId),
        actorUserId: asString(body.actorUserId),
        sendMode: asString(body.sendMode) ?? 'send',
        timezone: asString(body.timezone) ?? 'America/Los_Angeles',
        threadId: asString(body.threadId),
        query: asString(body.query),
        lookbackDays: Math.max(1, Math.min(30, asNumber(body.lookbackDays) ?? 14)),
        maxResults: Math.max(1, Math.min(25, asNumber(body.maxResults) ?? 10)),
        durationMinutes: Math.max(15, Math.min(120, asNumber(body.durationMinutes) ?? 30)),
        targetDayCount: Math.max(1, Math.min(7, asNumber(body.targetDayCount) ?? 3)),
        slotsPerDay: Math.max(1, Math.min(4, asNumber(body.slotsPerDay) ?? 1)),
        maxSlotsToEmail: Math.max(1, Math.min(8, asNumber(body.maxSlotsToEmail) ?? 3)),
        forceRequestResend: asBoolean(body.forceRequestResend),
        eventTypeSlug: asString(body.eventTypeSlug),
        username: asString(body.username),
        teamSlug: asString(body.teamSlug),
        organizationSlug: asString(body.organizationSlug),
        customMessage: asString(body.customMessage),
      };

  const resourceType = mode === 'transcript' ? 'interview' : 'candidate';
  const resourceId =
    mode === 'transcript'
      ? asString(body.interviewId) ?? bookingUid ?? candidateId ?? 'transcript'
      : (candidateId as string);

  const processNow = asBoolean(body.processNow) ?? true;
  const defaultProcessLimit = mode === 'book' ? 6 : mode === 'transcript' ? 4 : 1;
  const processLimit = Math.max(1, Math.min(10, asNumber(body.processNowLimit) ?? defaultProcessLimit));
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
        'v2',
        'agent',
        'liaison',
        handlerType,
        candidateId,
        jobId,
        bookingUid,
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
      check: 'v2_agent_liaison',
      status: 'success',
      architecture: 'v2',
      agent: 'liaison',
      handlerType,
      enqueued,
      processNow,
      processed,
    });
  } catch (error) {
    return jsonResponse(
      {
        check: 'v2_agent_liaison',
        status: 'error',
        message: error instanceof Error ? error.message : 'Liaison agent failed.',
      },
      500,
    );
  }
});
