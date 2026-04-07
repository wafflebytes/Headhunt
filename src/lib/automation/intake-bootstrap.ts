import { db } from '@/lib/db';
import { automationRuns } from '@/lib/db/schema/automation-runs';

const DEFAULT_INTAKE_QUERY =
  'in:inbox newer_than:14d -category:promotions -category:social -subject:newsletter -subject:digest -subject:unsubscribe';
const MIN_INITIAL_DELAY_MS = 10_000;
const MAX_INITIAL_DELAY_MS = 15 * 60 * 1000;

function parseBooleanEnv(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return undefined;
}

function parseNumberEnv(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(':')
    .slice(0, 240);
}

function resolveAutoIntakeOnCreateEnabled(): boolean {
  return parseBooleanEnv(process.env.AUTOMATION_AUTO_INTAKE_ON_JOB_CREATE) ?? true;
}

function resolveInitialIntakeDelayMs(): number {
  const configured = parseNumberEnv(process.env.AUTOMATION_INITIAL_INTAKE_DELAY_MS);
  if (typeof configured !== 'number') {
    return 60_000;
  }

  return clamp(configured, MIN_INITIAL_DELAY_MS, MAX_INITIAL_DELAY_MS);
}

function resolveFounderActorUserId(): string | null {
  const actor =
    process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ||
    process.env.AUTH0_FOUNDER_USER_ID?.trim() ||
    null;

  return actor && actor.length > 0 ? actor : null;
}

function resolveInitialIntakeMaxResults(): number {
  const configured = parseNumberEnv(process.env.AUTOMATION_INITIAL_INTAKE_MAX_RESULTS);
  if (typeof configured !== 'number') {
    return 20;
  }

  return clamp(configured, 1, 25);
}

function resolveInitialIntakeProcessLimit(): number {
  const configured = parseNumberEnv(process.env.AUTOMATION_INITIAL_INTAKE_PROCESS_LIMIT);
  if (typeof configured !== 'number') {
    return 8;
  }

  return clamp(configured, 1, 10);
}

function resolveInitialIntakeCandidateLikeOnly(): boolean {
  return parseBooleanEnv(process.env.AUTOMATION_INITIAL_INTAKE_CANDIDATE_LIKE_ONLY) ?? true;
}

function resolveInitialIntakeIncludeBody(): boolean {
  return parseBooleanEnv(process.env.AUTOMATION_INITIAL_INTAKE_INCLUDE_BODY) ?? true;
}

function resolveInitialIntakeGenerateIntel(): boolean {
  return parseBooleanEnv(process.env.AUTOMATION_INITIAL_INTAKE_GENERATE_INTEL) ?? true;
}

export type InitialIntakeEnqueueResult = {
  enabled: boolean;
  inserted: boolean;
  runId: string | null;
  idempotencyKey: string | null;
  scheduledFor: string | null;
};

export async function enqueueInitialIntakeScan(input: {
  jobId: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  tokenVaultLoginHint?: string | null;
  trigger: string;
  intakeQuery?: string;
}): Promise<InitialIntakeEnqueueResult> {
  if (!resolveAutoIntakeOnCreateEnabled()) {
    return {
      enabled: false,
      inserted: false,
      runId: null,
      idempotencyKey: null,
      scheduledFor: null,
    };
  }

  const jobId = input.jobId.trim();
  if (!jobId) {
    throw new Error('enqueueInitialIntakeScan requires a non-empty jobId.');
  }

  const now = new Date();
  const nextAttemptAt = new Date(now.getTime() + resolveInitialIntakeDelayMs());
  const idempotencyKey = buildIdempotencyKey(['intake-initial', input.organizationId, jobId]);
  const query =
    input.intakeQuery?.trim() ||
    process.env.AUTOMATION_INTAKE_QUERY?.trim() ||
    DEFAULT_INTAKE_QUERY;

  const actorUserId = input.actorUserId?.trim() || resolveFounderActorUserId();
  const tokenVaultLoginHint =
    actorUserId ||
    input.tokenVaultLoginHint?.trim() ||
    process.env.AUTH0_TOKEN_VAULT_LOGIN_HINT?.trim() ||
    null;

  const inserted = await db
    .insert(automationRuns)
    .values({
      handlerType: 'intake.scan',
      resourceType: 'job',
      resourceId: jobId,
      idempotencyKey,
      status: 'pending',
      payload: {
        agentName: 'intercept',
        trigger: input.trigger,
        organizationId: input.organizationId ?? null,
        jobId,
        actorUserId,
        tokenVaultLoginHint,
        query,
        maxResults: resolveInitialIntakeMaxResults(),
        processLimit: resolveInitialIntakeProcessLimit(),
        candidateLikeOnly: resolveInitialIntakeCandidateLikeOnly(),
        includeBody: resolveInitialIntakeIncludeBody(),
        generateIntel: resolveInitialIntakeGenerateIntel(),
      },
      result: {},
      nextAttemptAt,
      maxAttempts: 6,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [automationRuns.handlerType, automationRuns.idempotencyKey],
    })
    .returning({ id: automationRuns.id });

  return {
    enabled: true,
    inserted: inserted.length > 0,
    runId: inserted[0]?.id ?? null,
    idempotencyKey,
    scheduledFor: nextAttemptAt.toISOString(),
  };
}
