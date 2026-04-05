import dotenv from 'dotenv';

import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

type SendMode = 'draft' | 'send';

type CliArgs = {
  functionsBaseUrl: string;
  secret: string;
  organizationId: string;
  jobId: string;
  candidateId: string;
  actorUserId: string;
  username: string;
  eventTypeSlug: string;
  timezone: string;
  durationMinutes: number;
  requestSendMode: SendMode;
  processLimit: number;
  processNowLimit: number;
  skipIntercept: boolean;
  skipDispatch: boolean;
  strict: boolean;
  verbose: boolean;
  timeoutMs: number;
};

type EdgeResponse = {
  check?: string;
  status?: string;
  message?: string;
  mode?: string;
  agent?: string;
  handlerType?: string;
  enqueued?: {
    inserted?: boolean;
    runId?: string | null;
  };
  processed?: {
    claimed?: number;
    completed?: number;
    retried?: number;
    deadLettered?: number;
    agents?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

type AutomationRun = {
  id: string;
  handler_type: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  result: Record<string, unknown> | null;
  updated_at: string;
};

type StageSummary = {
  stage: string;
  ok: boolean;
  details: Record<string, unknown>;
};

function printUsage() {
  console.log(`Usage:
  npm run smoke:edge-e2e -- [options]

Options:
  --functions-base-url <url>   Supabase functions base URL (default: SUPABASE_FUNCTIONS_URL or derived from NEXT_PUBLIC_SUPABASE_URL)
  --secret <value>             Automation function secret (default: AUTOMATION_CRON_SECRET)
  --organization-id <id>       Organization id (default: org_demo_headhunt)
  --job-id <id>                Job id (default: job_demo_founding_engineer)
  --candidate-id <id>          Candidate id (default: oieoljho38zpyl73vrx1u)
  --actor-user-id <id>         Actor user id (default: google-oauth2|115071593952139464124)
  --username <slug>            Cal public username (default: headhunt)
  --event-type-slug <slug>     Cal event type slug (default: 30min)
  --timezone <tz>              Timezone (default: America/Los_Angeles)
  --duration-minutes <int>     Interview duration (default: 30)
  --request-send-mode <mode>   draft | send (default: send)
  --process-limit <int>        automation-cron process limit (default: 4)
  --process-now-limit <int>    Immediate queue process limit per agent call (default: 2)
  --timeout-ms <int>           Max ms to wait for each run to complete (default: 120000)
  --skip-intercept             Skip intake stage and start at analyst stage
  --skip-dispatch              Skip explicit dispatch stage if follow-up did not complete
  --strict                     Require booked interview and drafted offer in one run
  --non-strict                 Backward-compatible alias for non-strict mode
  --verbose                    Print full endpoint responses
  --help                       Show this help

Examples:
  npm run smoke:edge-e2e
  npm run smoke:edge-e2e -- --candidate-id <id> --request-send-mode draft --verbose
`);
}

function parseNumber(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${label}: ${value}`);
  }

  return parsed;
}

function deriveFunctionsBaseUrl(): string {
  const explicit = process.env.SUPABASE_FUNCTIONS_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || '';
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_FUNCTIONS_URL and unable to derive from NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL.');
  }

  const parsed = new URL(supabaseUrl);
  const host = parsed.hostname;
  const ref = host.split('.')[0];
  if (!ref) {
    throw new Error(`Unable to derive project ref from ${supabaseUrl}`);
  }

  return `https://${ref}.functions.supabase.co`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    functionsBaseUrl: deriveFunctionsBaseUrl(),
    secret:
      process.env.AUTOMATION_CRON_SECRET?.trim() ||
      process.env.SUPABASE_AUTOMATION_FUNCTION_SECRET?.trim() ||
      process.env.AUTOMATION_EXECUTE_SECRET?.trim() ||
      '',
    organizationId: process.env.HEADHUNT_SMOKE_ORG_ID?.trim() || 'org_demo_headhunt',
    jobId: process.env.HEADHUNT_SMOKE_JOB_ID?.trim() || 'job_demo_founding_engineer',
    candidateId: process.env.HEADHUNT_SMOKE_CANDIDATE_ID?.trim() || 'oieoljho38zpyl73vrx1u',
    actorUserId: process.env.HEADHUNT_SMOKE_ACTOR_ID?.trim() || 'google-oauth2|115071593952139464124',
    username: process.env.CAL_PUBLIC_USERNAME?.trim() || 'headhunt',
    eventTypeSlug: process.env.CAL_INTERVIEW_EVENT_TYPE_SLUG?.trim() || '30min',
    timezone: 'America/Los_Angeles',
    durationMinutes: 30,
    requestSendMode: 'send',
    processLimit: 4,
    processNowLimit: 2,
    skipIntercept: false,
    skipDispatch: false,
    strict: false,
    verbose: false,
    timeoutMs: 120000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--verbose') {
      args.verbose = true;
      continue;
    }

    if (arg === '--skip-intercept') {
      args.skipIntercept = true;
      continue;
    }

    if (arg === '--skip-dispatch') {
      args.skipDispatch = true;
      continue;
    }

    if (arg === '--non-strict') {
      args.strict = false;
      continue;
    }

    if (arg === '--strict') {
      args.strict = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--functions-base-url') {
      args.functionsBaseUrl = next.replace(/\/$/, '');
      index += 1;
      continue;
    }

    if (arg === '--secret') {
      args.secret = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--organization-id') {
      args.organizationId = next;
      index += 1;
      continue;
    }

    if (arg === '--job-id') {
      args.jobId = next;
      index += 1;
      continue;
    }

    if (arg === '--candidate-id') {
      args.candidateId = next;
      index += 1;
      continue;
    }

    if (arg === '--actor-user-id') {
      args.actorUserId = next;
      index += 1;
      continue;
    }

    if (arg === '--username') {
      args.username = next;
      index += 1;
      continue;
    }

    if (arg === '--event-type-slug') {
      args.eventTypeSlug = next;
      index += 1;
      continue;
    }

    if (arg === '--timezone') {
      args.timezone = next;
      index += 1;
      continue;
    }

    if (arg === '--duration-minutes') {
      args.durationMinutes = parseNumber(next, '--duration-minutes');
      index += 1;
      continue;
    }

    if (arg === '--request-send-mode') {
      if (next !== 'draft' && next !== 'send') {
        throw new Error(`Invalid --request-send-mode value: ${next}`);
      }

      args.requestSendMode = next;
      index += 1;
      continue;
    }

    if (arg === '--process-limit') {
      args.processLimit = parseNumber(next, '--process-limit');
      index += 1;
      continue;
    }

    if (arg === '--process-now-limit') {
      args.processNowLimit = parseNumber(next, '--process-now-limit');
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      args.timeoutMs = parseNumber(next, '--timeout-ms');
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.secret) {
    throw new Error('Missing automation secret. Provide --secret or set AUTOMATION_CRON_SECRET.');
  }

  return args;
}

async function callEdge<T extends EdgeResponse>(
  args: CliArgs,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${args.functionsBaseUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.secret}`,
      'x-automation-secret': args.secret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(args.timeoutMs),
  });

  const raw = await response.text();
  let payload: T;

  try {
    payload = JSON.parse(raw) as T;
  } catch {
    payload = { message: raw, status: 'error' } as T;
  }

  return { status: response.status, payload };
}

function createRunReader() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function processQueue(args: CliArgs) {
  return callEdge(args, 'automation-cron', {
    job: 'process',
    limit: args.processLimit,
  });
}

async function readRunById(runReader: ReturnType<typeof createRunReader>, runId: string): Promise<AutomationRun | null> {
  if (!runReader) {
    return null;
  }

  const { data, error } = await runReader
    .from('automation_runs')
    .select('id,handler_type,status,attempt_count,last_error,result,updated_at')
    .eq('id', runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read automation run ${runId}: ${error.message}`);
  }

  return data as AutomationRun | null;
}

async function waitForRun(
  args: CliArgs,
  runReader: ReturnType<typeof createRunReader>,
  runId: string,
  label: string,
): Promise<AutomationRun | null> {
  if (!runReader) {
    return null;
  }

  const started = Date.now();

  for (;;) {
    const run = await readRunById(runReader, runId);
    if (!run) {
      throw new Error(`Run ${runId} (${label}) was not found.`);
    }

    if (run.status === 'completed' || run.status === 'dead_letter') {
      return run;
    }

    if (Date.now() - started > args.timeoutMs) {
      throw new Error(`Timed out waiting for run ${runId} (${label}) to complete.`);
    }

    await processQueue(args);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getRunId(payload: EdgeResponse): string | null {
  return asString(payload.enqueued?.runId ?? null);
}

function findFollowUpRunId(result: Record<string, unknown>, handlerType: string): string | null {
  const followUps = result.followUps;
  if (!Array.isArray(followUps)) {
    return null;
  }

  for (const item of followUps) {
    const parsed = asRecord(item);
    if (asString(parsed.handlerType) === handlerType) {
      return asString(parsed.runId);
    }
  }

  return null;
}

function isOfferSentMode(mode: string | null): boolean {
  return mode === 'already_sent' || mode === 'sent_after_clearance';
}

function pushStage(stages: StageSummary[], stage: string, ok: boolean, details: Record<string, unknown>) {
  stages.push({ stage, ok, details });
}

function printStage(stage: StageSummary) {
  const marker = stage.ok ? 'PASS' : 'FAIL';
  console.log(`[${marker}] ${stage.stage}`);
  console.log(JSON.stringify(stage.details, null, 2));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const runReader = createRunReader();
  const stages: StageSummary[] = [];
  const runSeed = `${new Date().toISOString()}:${Math.random().toString(36).slice(2, 8)}`;

  console.log(
    JSON.stringify(
      {
        check: 'smoke_edge_e2e',
        functionsBaseUrl: args.functionsBaseUrl,
        organizationId: args.organizationId,
        jobId: args.jobId,
        candidateId: args.candidateId,
        requestSendMode: args.requestSendMode,
        strict: args.strict,
      },
      null,
      2,
    ),
  );

  if (!args.skipIntercept) {
    const intercept = await callEdge(args, 'agent-intercept', {
      organizationId: args.organizationId,
      jobId: args.jobId,
      candidateLikeOnly: true,
      processNow: true,
      processNowLimit: args.processNowLimit,
      maxResults: 8,
      processLimit: 4,
    });

    const ok = intercept.status === 200 && intercept.payload.status === 'success';
    pushStage(stages, 'intercept', ok, {
      httpStatus: intercept.status,
      check: intercept.payload.check,
      status: intercept.payload.status,
      enqueued: intercept.payload.enqueued,
      processed: intercept.payload.processed,
      message: intercept.payload.message ?? null,
    });
  }

  const analyst = await callEdge(args, 'agent-analyst', {
    candidateId: args.candidateId,
    jobId: args.jobId,
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    idempotencySeed: `${runSeed}:analyst`,
    automationMode: true,
    turns: 1,
    maxEvidenceChars: 2500,
    processNow: true,
    processNowLimit: args.processNowLimit,
  });

  if (args.verbose) {
    console.log(JSON.stringify({ analyst }, null, 2));
  }

  const analystRunId = getRunId(analyst.payload);
  const analystRun = analystRunId ? await waitForRun(args, runReader, analystRunId, 'analyst') : null;
  const analystResult = asRecord(analystRun?.result);

  pushStage(stages, 'analyst', analyst.status === 200 && analyst.payload.status === 'success', {
    httpStatus: analyst.status,
    runId: analystRunId,
    runStatus: analystRun?.status ?? null,
    check: analystResult.check ?? analyst.payload.check ?? null,
    resultStatus: analystResult.status ?? null,
    recommendation: asRecord(analystResult.consensus).recommendation ?? null,
    message: analyst.payload.message ?? analystRun?.last_error ?? null,
  });

  const liaisonRequest = await callEdge(args, 'agent-liaison', {
    mode: 'request',
    candidateId: args.candidateId,
    jobId: args.jobId,
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    idempotencySeed: `${runSeed}:liaison-request`,
    sendMode: args.requestSendMode,
    timezone: args.timezone,
    durationMinutes: args.durationMinutes,
    eventTypeSlug: args.eventTypeSlug,
    username: args.username,
    processNow: true,
    processNowLimit: args.processNowLimit,
  });

  const liaisonRequestRunId = getRunId(liaisonRequest.payload);
  const liaisonRequestRun = liaisonRequestRunId
    ? await waitForRun(args, runReader, liaisonRequestRunId, 'liaison_request')
    : null;
  const liaisonRequestResult = asRecord(liaisonRequestRun?.result);
  const requestRecord = asRecord(liaisonRequestResult.request);
  const requestMode = asString(liaisonRequestResult.mode);
  const requestOk =
    requestMode === 'request_sent' ||
    requestMode === 'request_drafted' ||
    (!args.strict && requestMode === 'waiting_for_candidate_reply');

  pushStage(stages, 'liaison_request', liaisonRequest.status === 200 && requestOk, {
    httpStatus: liaisonRequest.status,
    runId: liaisonRequestRunId,
    runStatus: liaisonRequestRun?.status ?? null,
    mode: requestMode,
    candidateEmail: liaisonRequestResult.candidateEmail ?? null,
    threadId: liaisonRequestResult.threadId ?? null,
    sendMode: requestRecord.sendMode ?? null,
    slotCount: Array.isArray(requestRecord.slotOptions) ? requestRecord.slotOptions.length : null,
    providerId: requestRecord.providerId ?? null,
    message: liaisonRequest.payload.message ?? liaisonRequestRun?.last_error ?? null,
  });

  const liaisonBook = await callEdge(args, 'agent-liaison', {
    mode: 'book',
    candidateId: args.candidateId,
    jobId: args.jobId,
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    idempotencySeed: `${runSeed}:liaison-book`,
    sendMode: 'draft',
    timezone: args.timezone,
    durationMinutes: args.durationMinutes,
    eventTypeSlug: args.eventTypeSlug,
    username: args.username,
    lookbackDays: 14,
    maxResults: 10,
    processNow: true,
    processNowLimit: args.processNowLimit,
  });

  const liaisonBookRunId = getRunId(liaisonBook.payload);
  const liaisonBookRun = liaisonBookRunId ? await waitForRun(args, runReader, liaisonBookRunId, 'liaison_book') : null;
  const liaisonBookResult = asRecord(liaisonBookRun?.result);
  const bookingMode = asString(liaisonBookResult.mode);
  const bookingEvent = asRecord(liaisonBookResult.event);
  const bookingLink =
    asString(bookingEvent.meetLink) || asString(bookingEvent.location) || asString(bookingEvent.bookingUid);
  const bookingOk =
    bookingMode === 'scheduled' ||
    bookingMode === 'already_scheduled' ||
    (!args.strict && bookingMode === 'waiting_for_candidate_reply');

  pushStage(stages, 'liaison_book', liaisonBook.status === 200 && bookingOk, {
    httpStatus: liaisonBook.status,
    runId: liaisonBookRunId,
    runStatus: liaisonBookRun?.status ?? null,
    mode: bookingMode,
    threadId: liaisonBookResult.threadId ?? null,
    matchedBy: liaisonBookResult.matchedBy ?? null,
    bookingUid: bookingEvent.bookingUid ?? null,
    bookingLink,
    message: liaisonBook.payload.message ?? liaisonBookRun?.last_error ?? null,
  });

  if (bookingMode !== 'scheduled') {
    pushStage(stages, 'dispatch_offer', !args.strict, {
      skipped: true,
      reason: 'Offer drafting waits for scheduled interview confirmation.',
      bookingMode,
    });

    pushStage(stages, 'offer_delivery', !args.strict, {
      skipped: true,
      reason: 'Offer delivery waits for scheduled interview confirmation.',
      bookingMode,
    });
  } else {
    let followUpOfferRunId = null as string | null;
    const followUps = liaisonBookResult.followUps;
    if (Array.isArray(followUps) && followUps.length > 0) {
      const first = asRecord(followUps[0]);
      followUpOfferRunId = asString(first.runId);
    }

    let followUpOfferRun: AutomationRun | null = null;
    if (followUpOfferRunId) {
      await processQueue(args);
      followUpOfferRun = await waitForRun(args, runReader, followUpOfferRunId, 'offer_followup');
    }

    let dispatchRun: AutomationRun | null = null;
    let dispatchRunId: string | null = null;

    if (!followUpOfferRun || followUpOfferRun.status !== 'completed') {
      if (!args.skipDispatch) {
        const dispatch = await callEdge(args, 'agent-dispatch', {
          action: 'draft',
          candidateId: args.candidateId,
          jobId: args.jobId,
          organizationId: args.organizationId,
          actorUserId: args.actorUserId,
          idempotencySeed: `${runSeed}:dispatch-draft`,
          templateId: 'default',
          processNow: true,
          processNowLimit: args.processNowLimit,
        });

        dispatchRunId = getRunId(dispatch.payload);
        dispatchRun = dispatchRunId ? await waitForRun(args, runReader, dispatchRunId, 'dispatch_manual') : null;

        if (args.verbose) {
          console.log(JSON.stringify({ dispatch }, null, 2));
        }
      }
    }

    const finalOfferRun = followUpOfferRun?.status === 'completed' ? followUpOfferRun : dispatchRun;
    const finalOfferResult = asRecord(finalOfferRun?.result);
    const finalOffer = asRecord(finalOfferResult.offer);
    const offerOk =
      asString(finalOfferResult.status) === 'success' && asString(finalOfferResult.check) === 'draft_offer_letter';

    pushStage(stages, 'dispatch_offer', offerOk, {
      sourceRunId: followUpOfferRun?.status === 'completed' ? followUpOfferRunId : dispatchRunId,
      runStatus: finalOfferRun?.status ?? null,
      check: finalOfferResult.check ?? null,
      status: finalOfferResult.status ?? null,
      offerId: finalOfferResult.offerId ?? null,
      offerStatus: finalOffer.status ?? null,
      offerSubject: finalOffer.subject ?? null,
      message: finalOfferRun?.last_error ?? null,
    });

    let submitRunId = findFollowUpRunId(finalOfferResult, 'offer.submit.clearance');
    let submitRun: AutomationRun | null = null;

    if (submitRunId) {
      await processQueue(args);
      submitRun = await waitForRun(args, runReader, submitRunId, 'offer_submit_clearance');
    }

    const submitResult = asRecord(submitRun?.result);
    let submitMode = asString(submitResult.mode);
    let deliveryRunId = submitRunId;

    if (submitMode === 'awaiting_clearance') {
      const pollRunId = findFollowUpRunId(submitResult, 'offer.clearance.poll');
      if (pollRunId) {
        await processQueue(args);
        const pollRun = await waitForRun(args, runReader, pollRunId, 'offer_clearance_poll');
        const pollResult = asRecord(pollRun?.result);
        if (asString(pollResult.check) === 'poll_offer_clearance') {
          submitMode = asString(pollResult.mode);
          deliveryRunId = pollRunId;
        }
      }
    }

    const deliveryOk = isOfferSentMode(submitMode);

    pushStage(stages, 'offer_delivery', deliveryOk, {
      runId: deliveryRunId,
      draftRunId: followUpOfferRun?.status === 'completed' ? followUpOfferRunId : dispatchRunId,
      submitRunId,
      mode: submitMode,
      check: submitResult.check ?? null,
      status: submitResult.status ?? null,
      offerId: submitResult.offerId ?? finalOfferResult.offerId ?? null,
      message: submitRun?.last_error ?? null,
    });
  }

  const allOk = stages.every((stage) => stage.ok);

  console.log('\nStage Results:');
  for (const stage of stages) {
    printStage(stage);
  }

  console.log(
    `\n${allOk ? 'SUCCESS' : 'FAILURE'}: smoke_edge_e2e ${allOk ? 'passed' : 'failed'} (${stages.filter((s) => s.ok).length}/${stages.length} stages).`,
  );

  if (!allOk) {
    process.exit(1);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke_edge_e2e failed: ${message}`);
  process.exit(1);
});
