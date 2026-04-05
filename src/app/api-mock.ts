type Provider = 'stripe' | 'gmail' | 'freshbooks';

export type Id<T extends string> = string;
export type Doc<T extends string> = any;

const now = Date.now();
const connectedProviders = new Set<Provider>(['gmail']);

const dashboardMetrics = {
  candidatesInPipeline: 68,
  openRoles: 8,
  avgDaysToFirstInterview: 4,
  interviewsThisWeek: 26,
  offersPendingApproval: 3,
  candidatesNeedingFollowUp: 11,
};

const agents = [
  {
    _id: 'agent_1',
    name: 'Triage Agent',
    action: 'Screening new applicants, ranking fit signals, and drafting recruiter follow-ups.',
    last: 'Last action 2m ago',
    files: [],
  },
  {
    _id: 'agent_2',
    name: 'Liaison Agent',
    action: 'Monitoring candidate threads and proposing interview slots with context-aware replies.',
    last: 'Last action 11m ago',
    files: [],
  },
];

const invoices = [
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

const clients = [
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

const pendingApprovals = [
  {
    _id: 'pending_1',
    actionType: 'send_interview_invite',
    resourceId: 'cand_001',
    message: 'Send founder-round interview invite to Anya Sharma for Senior Product Designer.',
    requestedAtMs: now - 8 * 60 * 1000,
    expiresAtMs: now + 7 * 60 * 1000,
    authReqId: 'authreq_8fd13a',
    payloadJson: JSON.stringify({
      candidate: {
        actionType: 'send_interview_invite',
        candidateName: 'Anya Sharma',
        jobTitle: 'Senior Product Designer',
        stage: 'interview_scheduled',
        score: 93,
      },
    }),
  },
  {
    _id: 'pending_2',
    actionType: 'send_offer_packet',
    resourceId: 'cand_004',
    message: 'Release offer packet to Ibrahim Noor for Frontend Lead.',
    requestedAtMs: now - 22 * 60 * 1000,
    expiresAtMs: now + 2 * 60 * 1000,
    authReqId: 'authreq_31ba79',
    payloadJson: JSON.stringify({
      candidate: {
        actionType: 'send_offer_packet',
        candidateName: 'Ibrahim Noor',
        jobTitle: 'Frontend Lead',
        stage: 'offer_sent',
        score: 87,
      },
    }),
  },
];

const key = {
  metrics: 'metrics.getDashboardMetrics',
  agents: 'agents.listAgents',
  approvals: 'approvals.listPendingApprovals',
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

const snapshotConnections = () =>
  (['stripe', 'gmail', 'freshbooks'] as const).map((provider) => ({
    _id: `connection_${provider}`,
    provider,
    status: connectedProviders.has(provider) ? 'connected' : 'disconnected',
    updatedAtMs: now,
  }));

export const useQuery = (...args: any[]): any => {
  const [queryName] = args;

  switch (queryName) {
    case key.metrics:
      return dashboardMetrics;
    case key.agents:
      return agents;
    case key.approvals:
      return pendingApprovals;
    case key.invoices:
      return invoices;
    case key.clients:
      return clients;
    case key.connectionStateList:
      return snapshotConnections();
    default:
      return [];
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

export const useUser = () => ({
  user: {
    name: 'Chaitanya',
    email: 'chaitanya@headhunt.ai',
  },
  isLoading: false,
});
