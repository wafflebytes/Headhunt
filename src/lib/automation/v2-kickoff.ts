import { dispatchSupabaseAutomationFunction } from '@/lib/automation/supabase-dispatch';

type KickoffParams = {
  jobId: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  tokenVaultLoginHint?: string | null;
  trigger: string;
};

export type V2IntakeKickoffResult = {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  functionName: string;
  message: string | null;
  data: unknown;
};

function resolveKickoffEnabled(): boolean {
  const raw = process.env.AUTOMATION_V2_KICKOFF_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return raw !== 'false';
}

function resolveProcessNowLimit(): number {
  const parsed = Number.parseInt(process.env.AUTOMATION_V2_KICKOFF_PROCESS_LIMIT ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return 3;
  }

  return Math.max(1, Math.min(10, parsed));
}

export async function kickoffV2IntakeFromSession(params: KickoffParams): Promise<V2IntakeKickoffResult> {
  if (!resolveKickoffEnabled()) {
    return {
      attempted: false,
      ok: false,
      status: null,
      functionName: 'v2-agent-intercept',
      message: 'AUTOMATION_V2_KICKOFF_ENABLED=false',
      data: null,
    };
  }

  const jobId = params.jobId.trim();
  if (!jobId) {
    return {
      attempted: false,
      ok: false,
      status: null,
      functionName: 'v2-agent-intercept',
      message: 'Missing jobId for v2 kickoff.',
      data: null,
    };
  }

  const dispatched = await dispatchSupabaseAutomationFunction({
    functionName: 'v2-agent-intercept',
    body: {
      organizationId: params.organizationId ?? null,
      jobId,
      actorUserId: params.actorUserId ?? null,
      tokenVaultLoginHint: params.tokenVaultLoginHint ?? null,
      processNow: true,
      processNowLimit: resolveProcessNowLimit(),
      candidateLikeOnly: true,
      includeBody: true,
      generateIntel: true,
      trigger: params.trigger,
      idempotencySeed: `${params.trigger}:${Date.now()}`,
    },
  });

  const dataRecord =
    dispatched.data && typeof dispatched.data === 'object' && !Array.isArray(dispatched.data)
      ? (dispatched.data as Record<string, unknown>)
      : null;

  const message =
    typeof dataRecord?.message === 'string'
      ? dataRecord.message
      : dispatched.ok
        ? null
        : `Supabase function call failed with status ${dispatched.status}.`;

  return {
    attempted: true,
    ok: dispatched.ok,
    status: dispatched.status,
    functionName: 'v2-agent-intercept',
    message,
    data: dispatched.data,
  };
}
