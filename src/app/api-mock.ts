import { useEffect, useState } from 'react';

type Provider = 'stripe' | 'gmail' | 'freshbooks';

export type Id<T extends string> = string;
export type Doc<T extends string> = any;

type DashboardMetrics = {
  candidatesInPipeline: number;
  openRoles: number;
  avgDaysToFirstInterview: number;
  interviewsThisWeek: number;
  offersPendingApproval: number;
  candidatesNeedingFollowUp: number;
};

type HiringStatePayload = {
  status?: string;
  metrics?: DashboardMetrics;
  agents?: unknown[];
  pendingApprovals?: unknown[];
  approvals?: unknown[];
  candidates?: unknown[];
  pipelineStages?: unknown[];
};

type UserContextPayload = {
  status?: string;
  user?: {
    sub?: string | null;
    name?: string | null;
    email?: string | null;
    picture?: string | null;
  };
  workspace?: {
    organizationId?: string | null;
    organizationName?: string | null;
    role?: string | null;
    avatarUrl?: string | null;
  };
};

const FALLBACK_METRICS: DashboardMetrics = {
  candidatesInPipeline: 0,
  openRoles: 0,
  avgDaysToFirstInterview: 0,
  interviewsThisWeek: 0,
  offersPendingApproval: 0,
  candidatesNeedingFollowUp: 0,
};

const FALLBACK_HIRING_STATE: HiringStatePayload = {
  status: 'error',
  metrics: FALLBACK_METRICS,
  agents: [],
  pendingApprovals: [],
  approvals: [],
  candidates: [],
  pipelineStages: [],
};

const FALLBACK_USER_CONTEXT: UserContextPayload = {
  status: 'error',
  user: {
    sub: null,
    name: null,
    email: null,
    picture: null,
  },
  workspace: {
    organizationId: null,
    organizationName: null,
    role: null,
    avatarUrl: null,
  },
};

const FALLBACK_INVOICES = [
  {
    id: 'INV-045',
    title: 'Q1 Retainer - Acme Corp',
    date: 'Mar 01',
    amount: '$4,800',
    status: 'Overdue',
    badgeBg: 'bg-[#fef2f2]',
    badgeText: 'text-[#e94235]',
    badgeBorder: 'border-[#fecaca]/60',
    buttons: [
      {
        label: 'Remind',
        text: 'text-white',
        bg: 'bg-[#0f172a] hover:bg-[#1e293b]',
      },
    ],
  },
  {
    id: 'INV-041',
    title: 'Website Refresh - Meridian Co.',
    date: 'Mar 08',
    amount: '$1,400',
    status: 'Overdue',
    badgeBg: 'bg-[#fef2f2]',
    badgeText: 'text-[#e94235]',
    badgeBorder: 'border-[#fecaca]/60',
    buttons: [
      {
        label: 'Remind',
        text: 'text-[#334155]',
        bg: 'bg-white hover:bg-[#f8fafc]',
        border: 'border border-[#cbd5e1]',
      },
    ],
  },
  {
    id: 'INV-046',
    title: 'Growth Sprint - StartupX',
    date: 'Mar 14',
    amount: '$1,400',
    status: 'Pending',
    badgeBg: 'bg-[#fffbeb]',
    badgeText: 'text-[#d4892a]',
    badgeBorder: 'border-[#fde68a]/60',
    buttons: [],
  },
  {
    id: 'INV-044',
    title: 'Platform Build - BlueBridge',
    date: 'Mar 20',
    amount: '$10,800',
    status: 'Paid',
    badgeBg: 'bg-[#f0fdf4]',
    badgeText: 'text-[#42a872]',
    badgeBorder: 'border-[#bbf7d0]/60',
    buttons: [],
  },
];

const FALLBACK_CLIENTS = [
  {
    name: 'BlueBridge',
    health: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    avg: '1.2d',
    cls: 'text-[#42a872]',
    open: '$10.8k',
    total: '$42.8k',
  },
  {
    name: 'Acme Corp',
    health: [1, 1, 1, -1, -1, 1, 1, -1, 1, -1],
    avg: '5.3d',
    cls: 'text-[#e94235]',
    open: '$4.8k',
    total: '$31.2k',
  },
  {
    name: 'StartupX',
    health: [1, 1, 0, 1, 0, 1, 1, 0, 1, 1],
    avg: '2.9d',
    cls: 'text-[#d4892a]',
    open: '$1.4k',
    total: '$18.0k',
  },
  {
    name: 'Foundry Labs',
    health: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    avg: '3.4d',
    cls: 'text-[#64748b]',
    open: '$3.2k',
    total: '$15.6k',
  },
];

const defaultConnectedProviders: Provider[] = ['gmail'];
const connectedProviders = new Set<Provider>(defaultConnectedProviders);

let cachedHiringState: HiringStatePayload | null = null;
let cachedAtMs = 0;
let inFlightHiringState: Promise<HiringStatePayload | null> | null = null;

const hiringRefreshListeners = new Set<() => void>();

export function requestHiringRefresh() {
  cachedHiringState = null;
  cachedAtMs = 0;
  for (const listener of hiringRefreshListeners) {
    listener();
  }
}

let cachedUserContext: UserContextPayload | null = null;
let cachedUserContextAtMs = 0;
let inFlightUserContext: Promise<UserContextPayload | null> | null = null;

const HIRING_CACHE_TTL_MS = 20 * 1000;
const USER_CONTEXT_CACHE_TTL_MS = 20 * 1000;

const key = {
  metrics: 'metrics.getDashboardMetrics',
  agents: 'agents.listAgents',
  approvals: 'approvals.listPendingApprovals',
  approvalsAll: 'approvals.listApprovals',
  candidates: 'candidates.listCandidates',
  pipeline: 'pipeline.listStages',
  invoices: 'invoices.listInvoices',
  clients: 'clients.listClients',
  connectionStateList: 'connectionState.listConnections',
  connectionStateMark: 'connectionState.markProviderConnected',
} as const;

export const api: any = {
  metrics: {
    getDashboardMetrics: key.metrics,
  },
  agents: {
    listAgents: key.agents,
  },
  approvals: {
    listPendingApprovals: key.approvals,
    listApprovals: key.approvalsAll,
  },
  candidates: {
    listCandidates: key.candidates,
  },
  pipeline: {
    listStages: key.pipeline,
  },
  invoices: {
    listInvoices: key.invoices,
  },
  clients: {
    listClients: key.clients,
  },
  connectionState: {
    listConnections: key.connectionStateList,
    markProviderConnected: key.connectionStateMark,
  },
} as const;

function isHiringCacheFresh(): boolean {
  return cachedHiringState !== null && Date.now() - cachedAtMs < HIRING_CACHE_TTL_MS;
}

async function fetchHiringState(): Promise<HiringStatePayload | null> {
  if (isHiringCacheFresh()) {
    return cachedHiringState;
  }

  if (inFlightHiringState) {
    return inFlightHiringState;
  }

  inFlightHiringState = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch('/api/hiring', {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as HiringStatePayload;
      cachedHiringState = payload;
      cachedAtMs = Date.now();
      return payload;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
      inFlightHiringState = null;
    }
  })();

  return inFlightHiringState;
}

function useHiringState(): HiringStatePayload | undefined {
  const [state, setState] = useState<HiringStatePayload | undefined>(() =>
    cachedHiringState ? cachedHiringState : undefined,
  );

  useEffect(() => {
    let cancelled = false;

    const slowFallbackId = setTimeout(() => {
      if (cancelled) {
        return;
      }

      setState((current) => current ?? FALLBACK_HIRING_STATE);
    }, 12_000);

    void fetchHiringState().then((payload) => {
      if (cancelled) {
        return;
      }

      clearTimeout(slowFallbackId);

      if (payload) {
        setState(payload);

        void fetch('/api/automation/tick', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
          },
          credentials: 'include',
          body: JSON.stringify({ mode: 'scheduling', limit: 4, passes: 2 }),
        })
          .then(async (res) => (res.ok ? ((await res.json()) as any) : null))
          .then((tick) => {
            const passes = Array.isArray(tick?.passes) ? tick.passes : [];
            const claimed = passes.reduce(
              (sum: number, entry: any) => sum + (typeof entry?.claimed === 'number' ? entry.claimed : 0),
              0,
            );
            if (!claimed) {
              return;
            }

            cachedHiringState = null;
            cachedAtMs = 0;
            void fetchHiringState().then((nextPayload) => {
              if (cancelled || !nextPayload) {
                return;
              }

              setState(nextPayload);
            });
          })
          .catch(() => null);

        return;
      }

      setState((current) => current ?? FALLBACK_HIRING_STATE);
    });

    return () => {
      cancelled = true;
      clearTimeout(slowFallbackId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const listener = () => {
      void fetchHiringState().then((payload) => {
        if (cancelled || !payload) {
          return;
        }

        setState(payload);
      });
    };

    hiringRefreshListeners.add(listener);
    return () => {
      cancelled = true;
      hiringRefreshListeners.delete(listener);
    };
  }, []);

  return state;
}

function isUserContextCacheFresh(): boolean {
  return cachedUserContext !== null && Date.now() - cachedUserContextAtMs < USER_CONTEXT_CACHE_TTL_MS;
}

async function fetchUserContext(): Promise<UserContextPayload | null> {
  if (isUserContextCacheFresh()) {
    return cachedUserContext;
  }

  if (inFlightUserContext) {
    return inFlightUserContext;
  }

  inFlightUserContext = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch('/api/account/context', {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as UserContextPayload;
      cachedUserContext = payload;
      cachedUserContextAtMs = Date.now();
      return payload;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
      inFlightUserContext = null;
    }
  })();

  return inFlightUserContext;
}

function useUserContext(): UserContextPayload | undefined {
  const [state, setState] = useState<UserContextPayload | undefined>(() =>
    cachedUserContext ? cachedUserContext : undefined,
  );

  useEffect(() => {
    let cancelled = false;

    const slowFallbackId = setTimeout(() => {
      if (cancelled) {
        return;
      }

      setState((current) => current ?? FALLBACK_USER_CONTEXT);
    }, 12_000);

    void fetchUserContext().then((payload) => {
      if (cancelled) {
        return;
      }

      clearTimeout(slowFallbackId);

      if (payload) {
        setState(payload);
        return;
      }

      setState((current) => current ?? FALLBACK_USER_CONTEXT);
    });

    return () => {
      cancelled = true;
      clearTimeout(slowFallbackId);
    };
  }, []);

  return state;
}

const snapshotConnections = () =>
  (['stripe', 'gmail', 'freshbooks'] as const).map((provider) => ({
    _id: `connection_${provider}`,
    provider,
    status: connectedProviders.has(provider) ? 'connected' : 'disconnected',
    updatedAtMs: Date.now(),
  }));

export const useQuery = (...args: any[]): any => {
  const [queryName] = args;
  const hiringState = useHiringState();

  switch (queryName) {
    case key.metrics:
      return hiringState?.metrics;
    case key.agents:
      return hiringState?.agents;
    case key.approvals:
      return hiringState?.pendingApprovals;
    case key.approvalsAll:
      return hiringState?.approvals;
    case key.candidates:
      return hiringState?.candidates;
    case key.pipeline:
      return hiringState?.pipelineStages;
    case key.invoices:
      return FALLBACK_INVOICES;
    case key.clients:
      return FALLBACK_CLIENTS;
    case key.connectionStateList:
      return snapshotConnections();
    default:
      return undefined;
  }
};

export const useMutation = (mutationName: unknown): any => {
  if (mutationName === key.connectionStateMark) {
    return async (args?: { provider?: Provider }) => {
      if (args?.provider) {
        connectedProviders.add(args.provider);
      }
      return { ok: true };
    };
  }

  return async () => ({ ok: true });
};

export const useAction = (): any => {
  return async () => ({ ok: true });
};

export const useUser = () => {
  const userContext = useUserContext();

  const fallbackName = 'Chaitanya';
  const fallbackEmail = 'chaitanya@headhunt.ai';

  return {
    user: {
      sub: userContext?.user?.sub ?? null,
      name: userContext?.user?.name ?? fallbackName,
      email: userContext?.user?.email ?? fallbackEmail,
      picture: userContext?.workspace?.avatarUrl ?? userContext?.user?.picture ?? null,
      organizationId: userContext?.workspace?.organizationId ?? null,
      organizationName: userContext?.workspace?.organizationName ?? null,
    },
    isLoading: userContext === undefined,
  };
};

export const frontendMockSeedData: Record<string, unknown> = {
  source: 'src/app/api-mock.ts',
  generatedAtMs: Date.now(),
  dashboardMetricsFallback: FALLBACK_METRICS,
  invoices: FALLBACK_INVOICES,
  clients: FALLBACK_CLIENTS,
  user: {
    name: 'Chaitanya',
    email: 'chaitanya@headhunt.ai',
  },
  providerConnections: (['stripe', 'gmail', 'freshbooks'] as const).map((provider) => ({
    provider,
    status: defaultConnectedProviders.includes(provider) ? 'connected' : 'disconnected',
  })),
  notes: 'Hiring metrics, candidates, pipeline, and approvals are served from /api/hiring.',
};
