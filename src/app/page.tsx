'use client';
import { useUser } from "@/app/api-mock";
import type { Doc, Id } from "@/app/api-mock";
import { useQuery, useMutation, useAction, api } from "@/app/api-mock";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import CommandMenuWrapper from '@/components/command-menu-wrapper';
import { ChatWindow, type ChatJobPickerOption } from '@/components/chat-window';
import {
  Activity02Icon as Activity02HugeIcon,
  Add01Icon as Add01HugeIcon,
  ArrowDown01Icon as ArrowDown01HugeIcon,
  ArrowRight01Icon as ArrowRight01HugeIcon,
  ArrowUp01Icon as ArrowUp01HugeIcon,
  ArrowUpDownIcon as ArrowUpDownHugeIcon,
  Briefcase01Icon as Briefcase01HugeIcon,
  Calendar01Icon as Calendar01HugeIcon,
  CheckmarkCircle02Icon as CheckmarkCircle02HugeIcon,
  Clock01Icon as Clock01HugeIcon,
  Copy01Icon as Copy01HugeIcon,
  DollarCircleIcon as DollarCircleHugeIcon,
  Home01Icon as Home01HugeIcon,
  MailSend02Icon as MailSend02HugeIcon,
  Message01Icon as Message01HugeIcon,
  Notification02Icon as Notification02HugeIcon,
  PanelLeftIcon as PanelLeftHugeIcon,
  PanelRightIcon as PanelRightHugeIcon,
  PipelineIcon as PipelineHugeIcon,
  PlayIcon as PlayHugeIcon,
  Robot02Icon as Robot02HugeIcon,
  FilterIcon as FilterHugeIcon,
  Search01Icon as Search01HugeIcon,
  SecurityCheckIcon as SecurityCheckHugeIcon,
  Settings02Icon as Settings02HugeIcon,
  Shield01Icon as Shield01HugeIcon,
  UserSettings01Icon as UserSettings01HugeIcon,
  WorkIcon as WorkHugeIcon,
  ZapIcon as ZapHugeIcon,
  Cancel01Icon as Cancel01HugeIcon,
} from '@hugeicons/core-free-icons';
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Dialog, DialogContent } from '@/components/ui/dialog';

import { DialogTitle } from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

type AppIconProps = {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
} & Record<string, unknown>;

const createAppIcon = (icon: any) => {
  function AppIcon({
    size = 18,
    color = 'currentColor',
    strokeWidth = 1.8,
    className,
    ...props
  }: AppIconProps) {
    return (
      <HugeIcon
        icon={icon}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={className}
        {...props}
      />
    );
  }

  return AppIcon;
};

const Home = createAppIcon(Home01HugeIcon);
const Jobs = createAppIcon(Briefcase01HugeIcon);
const Copy = createAppIcon(Copy01HugeIcon);
const CircleDollarSign = createAppIcon(PipelineHugeIcon);
const Users = createAppIcon(UserSettings01HugeIcon);
const Clock = createAppIcon(Clock01HugeIcon);
const Send = createAppIcon(MailSend02HugeIcon);
const Search = createAppIcon(Search01HugeIcon);
const Bot = createAppIcon(Robot02HugeIcon);
const Roles = createAppIcon(WorkHugeIcon);
const Settings = createAppIcon(Settings02HugeIcon);
const ArrowRight = createAppIcon(ArrowRight01HugeIcon);
const Play = createAppIcon(PlayHugeIcon);
const CheckCircle2 = createAppIcon(CheckmarkCircle02HugeIcon);
const ChevronDown = createAppIcon(ArrowDown01HugeIcon);
const Shield = createAppIcon(Shield01HugeIcon);
const Bell = createAppIcon(Notification02HugeIcon);
const Plus = createAppIcon(Add01HugeIcon);
const PanelLeft = createAppIcon(PanelLeftHugeIcon);
const PanelLeftClose = createAppIcon(PanelRightHugeIcon);
const Filter = createAppIcon(FilterHugeIcon);
const Close = createAppIcon(Cancel01HugeIcon);

type FilterOption = {
  id: string;
  label: string;
  category: string;
};

interface UnifiedFilterProps {
  options: FilterOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onToggleCategory?: (category: string, allIds: string[]) => void;
  placeholder?: string;
}

function UnifiedFilter({ options, selected, onToggle, onClear, onToggleCategory, placeholder = 'Filters' }: UnifiedFilterProps) {
  const selectedCount = selected.length;
  const isSingle = selectedCount === 1;
  
  const groups = useMemo(() => {
    const map: Record<string, FilterOption[]> = {};
    options.forEach(opt => {
      if (!map[opt.category]) map[opt.category] = [];
      map[opt.category].push(opt);
    });
    return map;
  }, [options]);

  const buttonLabel = useMemo(() => {
    if (selectedCount === 0) return null;
    
    // Check if exactly one category is fully selected
    const categoryEntries = Object.entries(groups);
    for (const [category, items] of categoryEntries) {
      const itemIds = items.map(i => i.id);
      const isCategoryFullySelected = itemIds.every(id => selected.includes(id));
      const hasOtherSelections = selected.some(id => !itemIds.includes(id));
      
      if (isCategoryFullySelected && !hasOtherSelections) {
        return `${category}: All`;
      }
    }

    if (isSingle) {
      return options.find(o => o.id === selected[0])?.label;
    }

    return `${selectedCount} Filters`;
  }, [selected, options, groups, selectedCount, isSingle]);

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            className={cn(
              "h-8 rounded-full border-[#cbd5e1] text-[12px] transition-all duration-300 px-3",
              selectedCount > 0 ? "bg-[#f8fafc] border-[#94a3b8] text-[#1e293b] font-medium" : "text-[#334155]"
            )}
          >
            {selectedCount === 0 ? (
              <>
                <Filter size={14} className="mr-1.5" />
                {placeholder}
              </>
            ) : (
              <span className="flex items-center gap-1.5 animate-in fade-in zoom-in duration-300">
                {buttonLabel}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px] font-sans rounded-xl border-[#d6dce1] p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[#94a3b8] px-2 py-2 flex items-center justify-between">
            <span>Filter Criteria</span>
            {selectedCount > 0 && <button onClick={onClear} className="text-[#e18131] hover:underline normal-case">Clear all</button>}
          </DropdownMenuLabel>
          
          {Object.entries(groups).map(([category, items]) => {
            const groupIds = items.map(i => i.id);
            const allSelected = groupIds.every(id => selected.includes(id));
            const someSelected = groupIds.some(id => selected.includes(id));
            
            return (
              <div key={category} className="mb-2 last:mb-0">
                <div 
                  className={cn(
                    "px-2 py-1 flex items-center justify-between text-[11px] font-semibold text-[#64748b] cursor-pointer hover:text-[#0f172a] transition-colors rounded",
                    someSelected && "text-[#1e293b]"
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    if (onToggleCategory) {
                      onToggleCategory(category, groupIds);
                    } else {
                      // Fallback bulk toggle
                      groupIds.forEach(id => {
                        const isSel = selected.includes(id);
                        if (allSelected) {
                          if (isSel) onToggle(id);
                        } else {
                          if (!isSel) onToggle(id);
                        }
                      });
                    }
                  }}
                >
                  <span className="uppercase tracking-wide">{category}</span>
                  <span className="text-[10px] text-[#94a3b8] hover:text-[#e18131]">
                    {allSelected ? 'Clear' : 'All'}
                  </span>
                </div>
                {items.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={selected.includes(option.id)}
                    onCheckedChange={() => onToggle(option.id)}
                    className="text-[13px] cursor-pointer rounded-md mx-1"
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedCount > 0 && (
        <button 
          onClick={onClear}
          className="p-1 hover:bg-[#f1f5f9] rounded-full text-[#94a3b8] hover:text-[#475569] transition-colors animate-in slide-in-from-left-2 duration-300"
        >
          <Close size={14} />
        </button>
      )}
    </div>
  );
}
const ChevronsUpDown = createAppIcon(ArrowUpDownHugeIcon);
const MessageSquare = createAppIcon(Message01HugeIcon);
const ShieldCheck = createAppIcon(SecurityCheckHugeIcon);
const HistoryIcon = createAppIcon(Activity02HugeIcon);
const Zap = createAppIcon(ZapHugeIcon);
const Calendar = createAppIcon(Calendar01HugeIcon);
const ArrowUp = createAppIcon(ArrowUp01HugeIcon);



type PendingApprovalDoc = Doc<'pendingApprovals'>;

type ApprovalCandidatePreview = {
  actionType?: string;
  candidateName?: string;
  jobTitle?: string;
  stage?: string;
  score?: number;
  invoiceNumber?: string;
  clientName?: string;
  amountMinor?: number;
  currency?: string;
};

const toActionLabel = (actionType: string | undefined): string => {
  const raw = actionType ?? 'approval_action';
  return raw
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const parseApprovalCandidate = (
  payloadJson: string | undefined,
): ApprovalCandidatePreview => {
  if (!payloadJson) return {};

  try {
    const parsed = JSON.parse(payloadJson) as {
      candidate?: ApprovalCandidatePreview;
    };
    return parsed.candidate ?? {};
  } catch {
    return {};
  }
};

const formatApprovalAmount = (
  amountMinor: number | undefined,
  currency: string | undefined,
): string => {
  if (typeof amountMinor !== 'number') return 'Amount unavailable';
  const normalizedCurrency = (currency ?? 'USD').toUpperCase();
  return `${normalizedCurrency} ${(amountMinor / 100).toFixed(2)}`;
};

const formatApprovalSummaryMeta = (candidate: ApprovalCandidatePreview): string => {
  if (candidate.stage) return toActionLabel(candidate.stage);
  if (typeof candidate.score === 'number') return `Score ${candidate.score}`;
  if (typeof candidate.amountMinor === 'number') {
    return formatApprovalAmount(candidate.amountMinor, candidate.currency);
  }
  return 'Context unavailable';
};

const formatRelativeTime = (timestampMs: number): string => {
  const deltaMs = Date.now() - timestampMs;
  const deltaMinutes = Math.max(Math.floor(deltaMs / 60000), 0);
  if (deltaMinutes < 1) return 'just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
};

const formatExpiry = (expiresAtMs: number | undefined): string => {
  if (typeof expiresAtMs !== 'number') return 'No expiry';
  const remainingSeconds = Math.floor((expiresAtMs - Date.now()) / 1000);
  if (remainingSeconds <= 0) return 'Expired';
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s remaining`;
  return `${seconds}s remaining`;
};

type HeadieAgentKey = 'triage' | 'liaison' | 'analyst' | 'dispatch' | 'intercept';
type HeadieAgentStatus = 'active' | 'standby';

type HeadieVisualConfig = {
  coloredSrc: string;
  graySrc: string;
};

type HeadieAgentSeed = {
  key: HeadieAgentKey;
  name: string;
  role: string;
  focus: string;
  defaultStatus: HeadieAgentStatus;
  defaultAction: string;
  defaultLast: string;
};

type HeadieAgentView = {
  _id: string;
  key: HeadieAgentKey;
  name: string;
  role: string;
  focus: string;
  status: HeadieAgentStatus;
  action: string;
  last: string;
};

const HEADIE_AGENT_VISUALS: Record<HeadieAgentKey, HeadieVisualConfig> = {
  triage: {
    coloredSrc: '/assets/headie-iconpack-coloured/headie-triage-coloured.png',
    graySrc: '/assets/headie-iconpack-grayed/headie-triage.png',
  },
  liaison: {
    coloredSrc: '/assets/headie-iconpack-coloured/headie-liason-coloured.png',
    graySrc: '/assets/headie-iconpack-grayed/headie-liason.png',
  },
  analyst: {
    coloredSrc: '/assets/headie-iconpack-coloured/headie-analyst-coloured.png',
    graySrc: '/assets/headie-iconpack-grayed/headie-analyst.png',
  },
  dispatch: {
    coloredSrc: '/assets/headie-iconpack-coloured/headie-dispatch-coloured.png',
    graySrc: '/assets/headie-iconpack-grayed/headie-dispatch.png',
  },
  intercept: {
    coloredSrc: '/assets/headie-iconpack-coloured/headie-inspect-coloured.png',
    graySrc: '/assets/headie-iconpack-grayed/headie-inspect.png',
  },
};

// Optical scaling keeps avatar perceived size consistent across artwork with different intrinsic padding.
const HEADIE_AGENT_AVATAR_SCALE_CLASS: Record<HeadieAgentKey, string> = {
  triage: 'scale-[1.05]',
  liaison: 'scale-[1.30]',
  analyst: 'scale-[0.95]',
  dispatch: 'scale-[1.30]',
  intercept: 'scale-[1.16]',
};

const getHeadieAvatarClass = (key: HeadieAgentKey, sizeClassName: string): string =>
  cn(sizeClassName, 'object-contain origin-center transform-gpu', HEADIE_AGENT_AVATAR_SCALE_CLASS[key]);

const HEADIE_AGENT_ROSTER_BASE: HeadieAgentSeed[] = [
  {
    key: 'triage',
    name: 'Triage Agent',
    role: 'Applicant ranking and intent triage',
    focus: 'Ranks fit signals and drafts recruiter follow-ups',
    defaultStatus: 'active',
    defaultAction: 'Screening inbound applicants and scoring role fit confidence.',
    defaultLast: 'Last action 2m ago',
  },
  {
    key: 'liaison',
    name: 'Liaison Agent',
    role: 'Interview loop coordination',
    focus: 'Coordinates schedules and candidate thread replies',
    defaultStatus: 'active',
    defaultAction: 'Monitoring candidate threads and proposing interview slots.',
    defaultLast: 'Last action 11m ago',
  },
  {
    key: 'analyst',
    name: 'Analyst Agent',
    role: 'Score analytics and rubric drift checks',
    focus: 'Calibrates rubric confidence and fairness indicators',
    defaultStatus: 'standby',
    defaultAction: 'Compiling signal deltas and score calibration snapshots.',
    defaultLast: 'Standing by',
  },
  {
    key: 'dispatch',
    name: 'Dispatch Agent',
    role: 'Offer packet release and handoff',
    focus: 'Prepares outbound packets and approval bundles',
    defaultStatus: 'active',
    defaultAction: 'Preparing offer packets and release approvals for signature.',
    defaultLast: 'Last action 6m ago',
  },
  {
    key: 'intercept',
    name: 'Intercept Agent',
    role: 'Inbox interception and route steering',
    focus: 'Flags high-intent replies and escalates to recruiters',
    defaultStatus: 'standby',
    defaultAction: 'Watching inbound replies and surfacing urgent candidate intent.',
    defaultLast: 'Standing by',
  },
];

const resolveHeadieAgentKey = (value: string | undefined): HeadieAgentKey => {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('triage')) return 'triage';
  if (normalized.includes('liaison') || normalized.includes('liason')) return 'liaison';
  if (normalized.includes('analyst')) return 'analyst';
  if (normalized.includes('dispatch')) return 'dispatch';
  if (normalized.includes('intercept') || normalized.includes('inspect')) return 'intercept';
  return 'triage';
};

const findHeadieSeed = (key: HeadieAgentKey): HeadieAgentSeed =>
  HEADIE_AGENT_ROSTER_BASE.find((item) => item.key === key) ?? HEADIE_AGENT_ROSTER_BASE[0];

const resolveApprovalAgentKey = (
  approval: PendingApprovalDoc,
  candidate: ApprovalCandidatePreview,
): HeadieAgentKey => {
  const context = `${candidate.actionType ?? ''} ${candidate.stage ?? ''} ${approval.actionType ?? ''}`.toLowerCase();

  if (context.includes('interview') || context.includes('schedule')) return 'liaison';
  if (context.includes('offer') || context.includes('packet') || context.includes('approve')) return 'dispatch';
  if (context.includes('score') || context.includes('analysis') || context.includes('rank')) return 'analyst';
  if (context.includes('intercept') || context.includes('source') || context.includes('inbound')) return 'intercept';
  return 'triage';
};

const resolveApprovalUrgency = (expiresAtMs: number | undefined): { label: string; className: string } => {
  if (typeof expiresAtMs !== 'number') {
    return {
      label: 'No expiry',
      className: 'bg-[#f1f5f9] text-[#64748b] border border-[#cbd5e1] shadow-none text-[10px] uppercase',
    };
  }

  const remainingSeconds = Math.floor((expiresAtMs - Date.now()) / 1000);
  if (remainingSeconds <= 0) {
    return {
      label: 'Expired',
      className: 'bg-[#fef2f2] text-[#e94235] border border-[#fecaca] shadow-none text-[10px] uppercase',
    };
  }

  if (remainingSeconds <= 120) {
    return {
      label: 'Critical',
      className: 'bg-[#fff1f2] text-[#be123c] border border-[#fecdd3] shadow-none text-[10px] uppercase',
    };
  }

  if (remainingSeconds <= 900) {
    return {
      label: 'Expiring soon',
      className: 'bg-[#fffbeb] text-[#b45309] border border-[#fcd34d] shadow-none text-[10px] uppercase',
    };
  }

  return {
    label: 'Pending',
    className: 'bg-[#ecfeff] text-[#0e7490] border border-[#a5f3fc] shadow-none text-[10px] uppercase',
  };
};

const SCREEN_TO_ROUTE: Record<string, string> = {
  dashboard: '/',
  jobs: '/jobs',
  pipeline: '/pipeline',
  candidates: '/candidates',
  agents: '/agents',
  approvals: '/approvals',
  audit: '/audit',
  team: '/team',
  settings: '/settings',
};

const ROUTE_TO_SCREEN: Record<string, string> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/jobs': 'jobs',
  '/pipeline': 'pipeline',
  '/candidates': 'candidates',
  '/agents': 'agents',
  '/approvals': 'approvals',
  '/audit': 'audit',
  '/team': 'team',
  '/settings': 'settings',
};

function resolveScreenFromPath(pathname: string): string {
  if (pathname === '/jobs') return 'jobs';
  if (pathname === '/pipeline') return 'pipeline';
  if (pathname === '/candidates' || pathname.startsWith('/candidates/')) return 'candidates';
  if (pathname === '/agents' || pathname.startsWith('/agents/')) return 'agents';
  if (pathname === '/workflows') return 'workflows';
  if (pathname === '/approvals') return 'approvals';
  if (pathname.startsWith('/audit')) return 'audit';
  if (pathname.startsWith('/team')) return 'team';
  if (pathname.startsWith('/settings')) return 'settings';
  return ROUTE_TO_SCREEN[pathname] ?? 'dashboard';
}

function resolvePathFromScreen(screen: string): string {
  if (screen === 'jobs') return '/jobs';
  if (screen === 'pipeline') return '/pipeline';
  if (screen === 'candidates') return '/candidates';
  if (screen === 'agents') return '/agents';
  if (screen === 'workflows') return '/workflows';
  if (screen === 'approvals') return '/approvals';
  return SCREEN_TO_ROUTE[screen] ?? '/';
}

const SCREEN_EXIT_TRANSITION_MS = 60; // Snappy exit animation duration
const SCREEN_NAVIGATION_FALLBACK_MS = 1500;

function AnimatedNumber({ value, prefix = "", suffix = "", delay = 0, padZero = false }: { value: number, prefix?: string, suffix?: string, delay?: number, padZero?: boolean }) {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    let startTimestamp: number;
    const duration = 1400; // ms
    const initialCount = countRef.current;

    if (initialCount === value) return;

    let timeoutId: NodeJS.Timeout;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const nextCount = Math.floor(initialCount + easeOut * (value - initialCount));

      setCount(nextCount);
      countRef.current = nextCount;

      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        setCount(value);
        countRef.current = value;
      }
    };

    timeoutId = setTimeout(() => {
      animationFrameId = window.requestAnimationFrame(step);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };

  }, [value, delay]);

  const displayCount = padZero && count < 10 ? `0${count}` : count.toLocaleString('en-US');

  return (
    <span
      className="inline-flex items-baseline animate-slide-up-fade"
      style={{ animationDelay: `${delay}ms` }}
    >
      {prefix && <span className="mr-[1px]">{prefix}</span>}
      <span className="tabular-nums inline-block" style={{ minWidth: value > 999 ? '3em' : value > 9 ? '1.2em' : '0.6em' }}>{displayCount}</span>
      {suffix && <span className="ml-[4px]">{suffix}</span>}
    </span>
  );
}

function NavItem({ icon, label, active = false, onClick, badge, isSidebarOpen = true }: { icon: React.ReactNode; label: string; active?: boolean, onClick?: () => void, badge?: number, isSidebarOpen?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-center rounded-[12px] cursor-pointer relative select-none",
        isSidebarOpen ? "px-[16px] py-[10px] w-[220px]" : "justify-center w-11 h-11 mx-auto p-0 mb-1",
        active ? "bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)] border border-[#e2e8f0]" : "hover:bg-white/50 border border-transparent"
      )}
      title={!isSidebarOpen ? label : undefined}
    >
      <div className={cn("shrink-0", isSidebarOpen ? "mr-[12px]" : "mr-0", active ? "text-[#304f67]" : "text-[#8e9caf] group-hover:text-[#64748b] transition-colors")}>
        {icon}
      </div>
      {isSidebarOpen && (
        <span className={cn(
          "text-[14px] tracking-[-0.2px] font-sans truncate",
          active ? "font-medium text-[#304f67]" : "text-[#64748b]"
        )}>
          {label}
        </span>
      )}
      {isSidebarOpen && badge && (
        <Badge className="ml-auto bg-[#e94235] hover:bg-[#d03d32] text-white font-medium border-none shadow-none shrink-0 text-[10px] px-1.5 py-0.5 h-auto rounded-full font-sans">
          {badge}
        </Badge>
      )}
      {!isSidebarOpen && badge && (
        <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-[#e94235] p-0 rounded-full ring-2 ring-[#f4f5f7]"></div>
      )}
    </div>
  );
}

const AUTOMATION_HUB_JOB_OPTIONS: ChatJobPickerOption[] = [
  { id: 'job_1', title: 'Founding Engineer', organizationId: 'org_1', isActive: true },
  { id: 'job_2', title: 'Product Designer', organizationId: 'org_1', isActive: true },
  { id: 'job_3', title: 'Growth Marketer', organizationId: 'org_1', isActive: true },
  { id: 'job_4', title: 'Recruiting Coordinator', organizationId: 'org_1', isActive: true },
];

function WorkflowsScreen({ initialQuery }: { initialQuery?: { text: string; id: number } | null }) {
  const { user } = useUser();
  const userId = user?.email || 'anonymous-user';

  return (
    <div className="flex h-full w-full bg-white text-[#334155] overflow-hidden relative rounded-[24px]">
      <ChatWindow
        key={userId}
        endpoint="api/chat"
        emptyStateComponent={<div />}
        emoji="⚡"
        placeholder={`Hello ${user?.name || 'there'}, welcome to Chat with Headie. How can I help with your hiring loops?`}
        userId={userId}
        jobOptions={AUTOMATION_HUB_JOB_OPTIONS}
        defaultJobId="job_1"
        initialQuery={initialQuery}
      />
    </div>
  );
}

function AssistantScreen() {
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);

  return (
    <div className="flex h-full w-full bg-white text-[#334155] overflow-hidden relative">
      {/* Internal History Sidebar */}
      <div className={cn("bg-[#f8fafc] border-r border-[#e2e8f0] flex flex-col transition-all duration-300 ease-in-out", isHistoryOpen ? "w-[260px]" : "w-0 opacity-0 pointer-events-none")}>
        <div className="p-4 border-b border-[#e2e8f0] bg-white flex items-center justify-between min-w-[260px]">
          <Button variant="outline" className="flex-1 h-10 px-4 rounded-[12px] border-[#cbd5e1] hover:bg-white hover:border-[#94a3b8] font-sans text-[14px] font-medium shadow-sm transition-all flex items-center justify-start gap-2 bg-white">
             <Plus size={16} className="text-[#0f172a]" /> New Chat
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setIsHistoryOpen(false)} className="ml-2 w-10 h-10 rounded-xl hover:bg-[#f1f5f9] text-[#64748b]">
             <PanelLeftClose size={18} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 hide-scrollbar min-w-[260px]">
          <div className="text-[11px] font-sans font-bold text-[#94a3b8] uppercase tracking-wider px-2 py-2">History</div>
          {[
            'Analysis: Overdue Invoices',
            'Q1 Collections Forecast',
            'Draft: Acme Corp Reminder',
            'Revenue Trends June 2024'
          ].map((title, i) => (
            <div key={i} className="group flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-[#e2e8f0]">
              <MessageSquare size={16} className="text-[#94a3b8] group-hover:text-[#e18131]" />
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-sans font-medium text-[#475569] group-hover:text-[#0f172a] truncate">{title}</span>
                <span className="text-[11px] font-sans text-[#94a3b8]">2 hours ago</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-[#fcfdfe] relative overflow-hidden">
        
        {/* Chat Area Top Bar (Subtle) */}
        {!isHistoryOpen && (
          <div className="p-4 absolute top-0 left-0 z-10">
            <Button variant="ghost" size="icon" onClick={() => setIsHistoryOpen(true)} className="w-10 h-10 rounded-xl bg-white border border-[#e2e8f0] shadow-sm hover:bg-[#f1f5f9] text-[#64748b]">
               <PanelLeft size={18} />
            </Button>
          </div>
        )}

        {/* Center Content / Scroll View */}
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-10 pt-20 pb-40 hide-scrollbar scroll-smooth">
          <div className="flex flex-col items-center max-w-[620px] w-full text-center">
            <div className="w-20 h-20 mb-10 rounded-[28px] bg-white border border-[#e2e8f0] flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.04)] relative group transition-transform hover:scale-[1.02]">
              <Bot size={44} strokeWidth={1.5} className="text-[#334155]" />
            </div>
            
            <h1 className="text-[34px] font-display font-medium text-[#1e293b] mb-4 tracking-[-0.03em] flex items-center justify-center gap-4">
              Ask Billing Brain <Badge className="bg-[#fffaf5] text-[#e18131] text-[10px] font-black uppercase tracking-[0.1em] border-none px-2 py-0.5 h-5 rounded-md">Beta</Badge>
            </h1>
            <p className="text-[16px] font-sans text-[#64748b] mb-14 max-w-[480px] leading-relaxed opacity-80">
              I can help you analyze your ledger, draft client reminders, or forecast your upcoming cash flow.
            </p>

            {/* Quick Action Pills */}
            <div className="grid grid-cols-2 gap-5 w-full">
              {[
                { label: 'Summarize overdue invoices', icon: <ShieldCheck size={18} /> },
                { label: 'Forecast next month sales', icon: <Zap size={18} /> },
                { label: 'Draft a payment reminder', icon: <Send size={18} /> },
                { label: 'Generate revenue report', icon: <Calendar size={18} /> }
              ].map((pill, i) => (
                <Button 
                  key={i} 
                  variant="outline" 
                  className="h-[64px] justify-start px-6 text-[15px] font-sans text-[#475569] hover:bg-white hover:text-[#0f172a] rounded-[24px] border-[#e2e8f0] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex items-center gap-5 transition-all hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] hover:border-[#cbd5e1] hover:-translate-y-0.5 border-b-[3px] border-b-[#cbd5e1]/40"
                >
                  <div className="w-9 h-9 rounded-[14px] bg-[#f8fafc] flex items-center justify-center text-[#94a3b8] group-hover:text-[#e18131] group-hover:bg-[#fffaf5] transition-colors">
                    {pill.icon}
                  </div>
                  {pill.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Root-anchored Prompt Box (Lowered) */}
        <div className="absolute bottom-0 left-0 right-0 p-10 bg-gradient-to-t from-[#fcfdfe] via-[#fcfdfe] to-transparent pt-20 pointer-events-none">
          <div className="max-w-[860px] mx-auto w-full pointer-events-auto">
            <div className="relative group">
              <div className="absolute inset-0 bg-[#0f172a]/5 blur-[64px] opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
              <div className="relative flex items-center gap-4 bg-white border border-[#cbd5e1] hover:border-[#94a3b8] transition-all rounded-[100px] p-2.5 pl-8 shadow-[0_4px_32px_rgba(0,0,0,0.05)] focus-within:shadow-[0_12px_48px_rgba(0,0,0,0.12)]">
                <input 
                  placeholder="Ask me anything financial..."
                  className="flex-1 bg-transparent border-none text-[17px] text-[#0f172a] placeholder:text-[#94a3b8] font-sans h-[44px] px-0 shadow-none leading-normal [outline:none!important] [ring:none!important] focus:!outline-none focus:!ring-0 focus:!border-none focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!border-none !border-none"
                />
                <Button size="icon" className="w-[44px] h-[44px] rounded-full bg-[#e18131] text-white hover:bg-[#c76922] flex items-center justify-center shadow-[0_4px_16px_rgba(15,23,42,0.25)] active:scale-95 transition-transform shrink-0 border-none mr-1">
                   <ArrowUp size={20} strokeWidth={2.5} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineScreen() {
  const [confirmAction, setConfirmAction] = useState<'reject' | 'fire' | null>(null);
  const [confirmCandidate, setConfirmCandidate] = useState<{ name: string; role: string; stageLabel: string } | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  const filterOptions: FilterOption[] = [
    { id: 'score-90', label: 'Score 90+', category: 'Performance' },
    { id: 'score-80', label: 'Score 80+', category: 'Performance' },
    { id: 'role-design', label: 'Product Designer', category: 'Role' },
    { id: 'role-ml', label: 'ML Engineer', category: 'Role' },
    { id: 'role-pm', label: 'Product Manager', category: 'Role' },
    { id: 'role-frontend', label: 'Frontend Lead', category: 'Role' },
  ];

  const handleToggleFilter = (id: string) => {
    setActiveFilters(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const stages = [
    {
      key: 'reviewed',
      label: 'Reviewed',
      count: 18,
      color: 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]',
      cards: [
        { name: 'Anya Sharma', role: 'Senior Product Designer', score: 93, eta: 'Reply pending' },
        { name: 'Marco Lin', role: 'Staff ML Engineer', score: 89, eta: 'Schedule next round' },
      ],
    },
    {
      key: 'interview_scheduled',
      label: 'Interview Scheduled',
      count: 9,
      color: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]',
      cards: [
        { name: 'Riya Patel', role: 'Founding PM', score: 91, eta: 'Mon 3:30 PM' },
        { name: 'Ibrahim Noor', role: 'Frontend Lead', score: 87, eta: 'Tue 11:00 AM' },
      ],
    },
    {
      key: 'interviewed',
      label: 'Interviewed',
      count: 7,
      color: 'bg-[#eef2ff] text-[#4338ca] border-[#c7d2fe]',
      cards: [
        { name: 'Keiko Sato', role: 'Senior Product Designer', score: 90, eta: 'Digest ready' },
        { name: 'Tommy Reed', role: 'Staff ML Engineer', score: 84, eta: 'Founder note needed' },
      ],
    },
    {
      key: 'offer_sent',
      label: 'Offer Sent',
      count: 3,
      color: 'bg-[#fff7ed] text-[#c2410c] border-[#fed7aa]',
      cards: [
        { name: 'Yuki Tan', role: 'Founding PM', score: 95, eta: 'Awaiting clearance' },
        { name: 'Nora Bloom', role: 'Frontend Lead', score: 88, eta: 'Comp revision' },
      ],
    },
    {
      key: 'hired',
      label: 'Hired',
      count: 2,
      color: 'bg-[#f0fdf4] text-[#15803d] border-[#bbf7d0]',
      cards: [
        { name: 'Jules Park', role: 'Product Designer', score: 92, eta: 'Start Apr 22' },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-4 max-w-[1120px] w-full mx-auto pb-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-[18px] font-heading font-medium text-[#1e293b]">Hiring Stage Board</div>
          <div className="text-[13px] font-sans text-[#64748b]">Move candidates through rounds with guardrails and fast actions.</div>
        </div>
        <div className="flex items-center gap-2">
          <UnifiedFilter 
            options={filterOptions}
            selected={activeFilters}
            onToggle={handleToggleFilter}
            onClear={() => setActiveFilters([])}
          />
          <Button className="h-8 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[12px]">
            Invite Top Candidates
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 h-[calc(100vh-265px)] min-h-[420px]">
        {stages.map((stage) => (
          <Card key={stage.key} className="rounded-[18px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col">
            <CardContent className="p-0 flex flex-col h-full">
              <div className="px-3.5 py-3 border-b border-[#eef2f7] flex items-center justify-between bg-[#fbfcfe]">
                <span className="text-[11px] uppercase tracking-wider font-heading font-semibold text-[#64748b]">{stage.label}</span>
                <Badge className={cn('text-[10px] shadow-none border font-sans', stage.color)}>{stage.count}</Badge>
              </div>
              <div className="p-3 space-y-3 overflow-y-auto hide-scrollbar">
                {stage.cards.filter(candidate => {
                  if (activeFilters.length === 0) return true;
                  
                  const matchesScore90 = activeFilters.includes('score-90') && candidate.score >= 90;
                  const matchesScore80 = activeFilters.includes('score-80') && candidate.score >= 80;
                  
                  const roleFilters = activeFilters.filter(f => f.startsWith('role-'));
                  const matchesRole = roleFilters.length === 0 || roleFilters.some(f => {
                    if (f === 'role-design') return candidate.role.includes('Designer');
                    if (f === 'role-ml') return candidate.role.includes('ML');
                    if (f === 'role-pm') return candidate.role.includes('PM');
                    if (f === 'role-frontend') return candidate.role.includes('Frontend');
                    return false;
                  });

                  const scoreFilters = activeFilters.filter(f => f.startsWith('score-'));
                  const matchesScore = scoreFilters.length === 0 || matchesScore90 || (activeFilters.includes('score-80') && candidate.score >= 80);

                  return matchesRole && matchesScore;
                }).map((candidate) => (
                  <div
                    key={`${stage.key}-${candidate.name}`}
                    className="group relative rounded-[14px] border border-[#e2e8f0] bg-white p-3.5 shadow-[0_1px_6px_rgba(0,0,0,0.03)]"
                  >
                    <div className="transition-all duration-250 group-hover:opacity-0 group-hover:blur-[6px] group-hover:scale-[0.985]">
                      <div className="text-[13px] font-sans font-medium text-[#1e293b] truncate">{candidate.name}</div>
                      <div className="text-[12px] font-sans text-[#64748b] mt-1 truncate">{candidate.role}</div>
                      <div className="flex items-center justify-between mt-3">
                        <Badge className="text-[10px] bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] shadow-none">score {candidate.score}</Badge>
                        <span className="text-[11px] font-sans text-[#94a3b8]">{candidate.eta}</span>
                      </div>
                    </div>

                    <div className="absolute inset-0 p-3 flex flex-col justify-center gap-1.5 opacity-0 blur-[8px] scale-[0.98] transition-all duration-250 group-hover:opacity-100 group-hover:blur-none group-hover:scale-100 pointer-events-none group-hover:pointer-events-auto">
                      {stage.key === 'hired' ? (
                        <>
                          <Button size="sm" className="h-7 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[11px]">Manage Payroll</Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => {
                              setConfirmAction('fire');
                              setConfirmCandidate({ name: candidate.name, role: candidate.role, stageLabel: stage.label });
                            }}
                            className="h-7 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 text-[11px]"
                          >
                            Fire Candidate
                          </Button>
                        </>
                      ) : (
                        <>
                          {(stage.key === 'reviewed' || stage.key === 'interview_scheduled' || stage.key === 'interviewed') && (
                            <Button size="sm" className="h-7 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[11px]">
                              {stage.key === 'interviewed' ? 'Schedule again' : 'Schedule'}
                            </Button>
                          )}
                          
                          {stage.key === 'interviewed' && (
                            <Button size="sm" variant="outline" className="h-7 rounded-full border-[#cbd5e1] text-[11px] text-[#334155]">Draft Offer</Button>
                          )}

                          {stage.key === 'offer_sent' && (
                            <Button size="sm" className="h-7 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[11px]">Send offer again</Button>
                          )}

                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => {
                              setConfirmAction('reject');
                              setConfirmCandidate({ name: candidate.name, role: candidate.role, stageLabel: stage.label });
                            }}
                            className="h-7 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 text-[11px]"
                          >
                            Reject Candidate
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[400px] rounded-[24px] p-6 bg-white border border-[#dbe4ef] shadow-[0_10px_40px_rgba(15,23,42,0.12)]">
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-4">
              <Activity02HugeIcon size={24} />
            </div>
            <DialogTitle className="text-[18px] font-heading font-semibold text-[#0f172a] mb-2 px-4 leading-tight">
              {confirmAction === 'reject' ? 'Reject Candidate?' : 'Fire Candidate?'}
            </DialogTitle>
            <p className="text-[14px] text-[#64748b] leading-relaxed mb-6 px-4">
              {confirmAction === 'reject' 
                ? `Are you sure you want to reject ${confirmCandidate?.name}? This will remove them from the active pipeline.`
                : `Are you sure you want to fire ${confirmCandidate?.name}? This is a permanent administrative action.`}
            </p>
            <div className="flex flex-col w-full gap-2 px-4 mt-2">
              <Button 
                onClick={() => setConfirmAction(null)}
                className="w-full h-[44px] bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md border-none font-medium"
              >
                {confirmAction === 'reject' ? 'Yes, Reject' : 'Yes, Fire Candidate'}
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => setConfirmAction(null)}
                className="w-full h-[44px] text-[#64748b] hover:bg-[#f8fafc] rounded-xl font-medium"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoicesScreen() {
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const filterOptions: FilterOption[] = [
    { id: 'status-paid', label: 'Paid', category: 'Status' },
    { id: 'status-pending', label: 'Pending', category: 'Status' },
    { id: 'status-overdue', label: 'Overdue', category: 'Status' },
    { id: 'client-acme', label: 'Acme Corp', category: 'Client' },
    { id: 'client-blue', label: 'BlueBridge', category: 'Client' },
    { id: 'client-foundry', label: 'Foundry Labs', category: 'Client' },
    { id: 'client-meridian', label: 'Meridian Co.', category: 'Client' },
    { id: 'client-startupx', label: 'StartupX', category: 'Client' },
  ];

  const handleToggleFilter = (id: string) => {
    setActiveFilters(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const invoicesRaw = useQuery(api.invoices.listInvoices);
  const [invoices, setInvoices] = useState<any[]>([]);
  const invRef = useRef<any[]>([]);

  useEffect(() => {
    // Only update state if we have valid, non-empty data. 
    // This prevents the "flash back to empty" if the query blips nil.
    if (invoicesRaw !== undefined && invoicesRaw.length > 0) {
      setInvoices(invoicesRaw as any[]);
      invRef.current = invoicesRaw as any[];
    }
  }, [invoicesRaw]);

  const isLoading = invoicesRaw === undefined && invoices.length === 0;

  const filtered = invoices.filter(inv => {
    if (search && !inv.title.toLowerCase().includes(search.toLowerCase()) && !inv.id.toLowerCase().includes(search.toLowerCase())) return false;
    
    if (activeFilters.length === 0) return true;

    const statusFilters = activeFilters.filter(f => f.startsWith('status-'));
    const matchesStatus = statusFilters.length === 0 || statusFilters.some(f => {
      const s = f.split('-')[1];
      if (s === 'paid') return inv.status === 'Paid';
      if (s === 'pending') return inv.status === 'Pending' || inv.status === 'Draft';
      if (s === 'overdue') return inv.status === 'Overdue';
      return false;
    });

    const clientFilters = activeFilters.filter(f => f.startsWith('client-'));
    const matchesClient = clientFilters.length === 0 || clientFilters.some(f => {
      const c = f.split('-')[1];
      if (c === 'acme') return inv.client === 'Acme Corp';
      if (c === 'blue') return inv.client === 'BlueBridge';
      if (c === 'foundry') return inv.client === 'Foundry Labs';
      if (c === 'meridian') return inv.client === 'Meridian Co.';
      if (c === 'startupx') return inv.client === 'StartupX';
      return false;
    });

    return matchesStatus && matchesClient;
  });

  return (
    <div className="flex flex-col gap-4 max-w-[1000px] w-full mx-auto pb-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" size={16} />
            <Input 
              placeholder="Search invoices..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-[180px] h-[36px] bg-white border-[#cbd5e1] text-[13px] rounded-lg shadow-sm font-sans focus-visible:ring-1 focus-visible:ring-[#cbd5e1]"
            />
          </div>
          
          <UnifiedFilter 
            options={filterOptions}
            selected={activeFilters}
            onToggle={handleToggleFilter}
            onClear={() => setActiveFilters([])}
            placeholder="Filter Invoices"
          />
        </div>
        <Button className="bg-[#e18131] hover:bg-[#c76922] text-white rounded-lg h-[36px] text-[13px] font-medium shadow-sm transition-all shrink-0">
          <Plus size={14} className="mr-1.5" /> Draft invoice
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          // Stable skeleton — no layout shift, no flicker
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-3.5 flex items-center justify-between gap-4 animate-pulse">
              <div className="flex items-center gap-4 flex-1">
                <div className="w-16 h-3 bg-[#f1f5f9] rounded" />
                <div className="flex-1 h-3 bg-[#f1f5f9] rounded max-w-[200px]" />
              </div>
              <div className="flex items-center gap-5">
                <div className="w-10 h-3 bg-[#f1f5f9] rounded hidden sm:block" />
                <div className="w-16 h-3 bg-[#f1f5f9] rounded" />
                <div className="w-20 h-6 bg-[#f1f5f9] rounded-full" />
              </div>
            </div>
          ))
        ) : (
          <>
            {filtered.map(inv => (
              <Card key={inv.id} className="group rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] hover:-translate-y-[1px] hover:border-[#cbd5e1] transition-all cursor-pointer">
                <CardContent className="p-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className="font-mono text-[12px] text-[#64748b] w-16 shrink-0">{inv.id}</span>
                    <span className="font-sans text-[14px] text-[#334155] flex-1 font-medium truncate">{inv.title}</span>
                  </div>
                  <div className="flex items-center justify-end gap-5">
                    <span className="hidden sm:inline-block font-sans text-[13px] text-[#64748b] w-12 text-right shrink-0">{inv.date}</span>
                    <span className="font-sans text-[14px] font-semibold text-[#0f172a] w-20 text-right shrink-0">{inv.amount}</span>
                    
                    {/* Crossfade wrapper */}
                    <div className="relative flex justify-end items-center h-8 w-[80px] sm:w-[154px]">
                      {/* Badge */}
                      <div className={cn("absolute right-0 flex items-center transition-all duration-300 ease-out origin-right", inv.buttons?.length > 0 ? "opacity-100 blur-none group-hover:opacity-0 group-hover:blur-[8px] scale-100 group-hover:scale-95 pointer-events-auto group-hover:pointer-events-none" : "opacity-100")}>
                        <Badge className={`w-20 justify-center text-[10px] uppercase font-medium ${inv.badgeBg} ${inv.badgeText} hover:${inv.badgeBg} rounded-full tracking-wide shadow-none border ${inv.badgeBorder}`}>{inv.status}</Badge>
                      </div>
                      
                      {/* Action Buttons */}
                      {inv.buttons?.length > 0 && (
                        <div className="absolute right-0 flex items-center gap-2 justify-end transition-all duration-300 ease-out opacity-0 blur-[8px] translate-x-3 scale-95 group-hover:opacity-100 group-hover:blur-none group-hover:translate-x-0 group-hover:scale-100 pointer-events-none group-hover:pointer-events-auto origin-right">
                          {inv.buttons.map((btn: any, idx: number) => (
                            <Button key={idx} variant={btn.noVariant ? 'default' : 'outline'} size="sm" className={`h-7 text-[11px] font-medium ${btn.text} ${btn.bg} ${btn.border || ''} ${btn.hiddenSm ? 'hidden md:inline-flex' : ''} shadow-sm hover:shadow-md`}>
                              {btn.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-10 text-[13px] font-sans text-[#a0afbb]">No invoices match your filter.</div>
            )}
          </>
        )}
      </div>

    </div>
  );
}

function ClientsScreen() {
  const [activeClient, setActiveClient] = useState<string | null>(null);
  const clientsRaw = useQuery(api.clients.listClients);
  const [clients, setClients] = useState<any[]>([]);
  const cliRef = useRef<any[]>([]);

  useEffect(() => {
    // Stickiness: Keep old clients if the new query result is empty/null
    if (clientsRaw !== undefined && clientsRaw.length > 0) {
      setClients(clientsRaw as any[]);
      cliRef.current = clientsRaw as any[];
    }
  }, [clientsRaw]);

  const clientsLoading = clientsRaw === undefined && clients.length === 0;

  if (activeClient) {
    return (
      <div key="detail" className="animate-blur-fade-in w-full">
      <div className="flex flex-col gap-6 w-full max-w-[1000px] mx-auto pb-10">
        <div className="flex items-center justify-between mb-2 border-b border-[#e2e8f0] pb-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setActiveClient(null)} className="flex items-center justify-center w-8 h-8 rounded-full border border-[#cbd5e1] hover:bg-[#f8fafc] text-[#64748b] transition-colors"><span className="text-lg leading-none -mt-1">←</span></button>
            <div>
              <div className="text-[20px] font-heading font-medium text-[#1e293b]">{activeClient}</div>
              <div className="text-[13px] font-sans text-[#64748b]">Connected via HubSpot CRM</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-8 text-[12px] bg-white"><Clock size={14} className="mr-1.5" /> Stop work</Button>
            <Button className="h-8 text-[12px] bg-[#e18131] hover:bg-[#c76922] text-white"><Plus size={14} className="mr-1.5" /> New invoice</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="grid grid-cols-3 gap-4">
              <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"><CardContent className="p-4"><div className="text-[12px] font-heading text-[#64748b] uppercase tracking-wide">Avg payment</div><div className="text-[24px] font-sans font-medium text-[#1e293b] mt-1">2.4 days</div><div className="text-[11px] text-[#42a872] mt-1">Excellent payer</div></CardContent></Card>
              <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"><CardContent className="p-4"><div className="text-[12px] font-heading text-[#64748b] uppercase tracking-wide">Total paid</div><div className="text-[24px] font-sans font-medium text-[#1e293b] mt-1">$42,800</div><div className="text-[11px] text-[#64748b] mt-1">YTD: $12,600</div></CardContent></Card>
              <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"><CardContent className="p-4"><div className="text-[12px] font-heading text-[#64748b] uppercase tracking-wide">Outstanding</div><div className="text-[24px] font-sans font-medium text-[#1e293b] mt-1 text-[#e94235]">$4,800</div><div className="text-[11px] text-[#e94235] mt-1 font-medium">1 overdue</div></CardContent></Card>
            </div>
            
            <div className="flex flex-col">
              <div className="text-[14px] font-heading font-medium text-[#334155] mb-3">Recent Invoices</div>
              <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
                <div className="flex items-center justify-between p-3.5 border-b border-[#f1f5f9] hover:bg-[#f8fafc] cursor-pointer cursor-pointer bg-white">
                  <span className="font-mono text-[12px] text-[#64748b] w-16 shrink-0">INV-045</span>
                  <span className="font-sans text-[14px] text-[#334155] flex-1 font-medium">Q1 Retainer</span>
                  <span className="font-sans text-[14px] font-medium text-[#0f172a] w-20 text-right">$4,800</span>
                  <Badge className="ml-4 w-16 justify-center text-[10px] uppercase bg-[#fef2f2] text-[#e94235] hover:bg-[#fef2f2] shadow-none">Overdue</Badge>
                </div>
                <div className="flex items-center justify-between p-3.5 border-b border-[#f1f5f9] hover:bg-[#f8fafc] cursor-pointer bg-white">
                  <span className="font-mono text-[12px] text-[#64748b] w-16 shrink-0">INV-044</span>
                  <span className="font-sans text-[14px] text-[#334155] flex-1 font-medium">Q1 Development</span>
                  <span className="font-sans text-[14px] font-medium text-[#0f172a] w-20 text-right">$10,800</span>
                  <Badge className="ml-4 w-16 justify-center text-[10px] uppercase bg-[#f0fdf4] text-[#42a872] hover:bg-[#f0fdf4] shadow-none">Paid</Badge>
                </div>
                <div className="flex items-center justify-between p-3.5 hover:bg-[#f8fafc] cursor-pointer bg-white">
                  <span className="font-mono text-[12px] text-[#64748b] w-16 shrink-0">INV-039</span>
                  <span className="font-sans text-[14px] text-[#334155] flex-1 font-medium">Project kickoff</span>
                  <span className="font-sans text-[14px] font-medium text-[#0f172a] w-20 text-right">$2,400</span>
                  <Badge className="ml-4 w-16 justify-center text-[10px] uppercase bg-[#f0fdf4] text-[#42a872] hover:bg-[#f0fdf4] shadow-none">Paid</Badge>
                </div>
              </Card>
            </div>
          </div>
          
          <div className="flex flex-col gap-4">
            <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="text-[12px] font-heading text-[#64748b] uppercase tracking-wide border-b border-[#f1f5f9] pb-2">Client Details</div>
                <div><div className="text-[10px] text-[#94a3b8] uppercase font-sans tracking-wide">Contact</div><div className="text-[13px] text-[#334155] font-medium font-sans mt-0.5">Jane Doe<br/><span className="text-[#64748b] font-normal">jane@acmecorp.com</span></div></div>
                <div><div className="text-[10px] text-[#94a3b8] uppercase font-sans tracking-wide">Billing Email</div><div className="text-[13px] text-[#334155] font-sans mt-0.5">ap@acmecorp.com</div></div>
                <div><div className="text-[10px] text-[#94a3b8] uppercase font-sans tracking-wide">Payment Terms</div><div className="text-[13px] text-[#334155] font-sans mt-0.5">Net 30</div></div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div key="list" className="animate-blur-fade-in w-full">
    <div className="flex flex-col gap-4 max-w-[1000px] w-full mx-auto pb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" size={16} />
          <Input placeholder="Search clients..." className="pl-9 w-[260px] h-[36px] bg-white border-[#cbd5e1] text-[13px] rounded-lg shadow-sm" />
        </div>
        <Button className="bg-[#e18131] hover:bg-[#c76922] text-white rounded-lg h-[36px] text-[13px] font-medium shadow-sm">
          <Plus size={14} className="mr-1.5" /> Add Client
        </Button>
      </div>

      <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] text-[11px] font-heading font-semibold text-[#64748b] uppercase tracking-wider">
          <div className="col-span-3">Client</div>
          <div className="col-span-3">Payment Health</div>
          <div className="col-span-2 text-right">Avg Days Late</div>
          <div className="col-span-2 text-right">Open</div>
          <div className="col-span-2 text-right">Total Paid</div>
        </div>
        
        <div className="flex flex-col">
          {clientsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[#f1f5f9] items-center animate-pulse">
                <div className="col-span-3 h-3 bg-[#f1f5f9] rounded" />
                <div className="col-span-3 flex gap-1">{Array.from({length:10}).map((_,j)=><div key={j} className="w-[6px] h-3.5 bg-[#f1f5f9] rounded-sm" />)}</div>
                <div className="col-span-2 flex justify-end"><div className="w-16 h-3 bg-[#f1f5f9] rounded" /></div>
                <div className="col-span-2 flex justify-end"><div className="w-14 h-3 bg-[#f1f5f9] rounded" /></div>
                <div className="col-span-2 flex justify-end"><div className="w-12 h-3 bg-[#f1f5f9] rounded" /></div>
              </div>
            ))
          ) : (
            clients.map((c, i) => (
              <div key={i} onClick={() => setActiveClient(c.name)} className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[#f1f5f9] hover:bg-[#fdfdfd] cursor-pointer items-center transition-colors">
                <div className="col-span-3 font-sans text-[14px] font-medium text-[#334155]">{c.name}</div>
                <div className="col-span-3 flex items-center gap-[2px]">
                  {c.health?.map((h: any, hi: number) => (
                    <div key={hi} className={cn("w-[6px] h-3.5 rounded-sm shadow-sm", h === 1 ? "bg-[#10b981]" : h === 0 ? "bg-[#cbd5e1]" : "bg-[#ef4444]")} />
                  ))}
                </div>
                <div className={cn("col-span-2 text-right font-sans text-[13px] font-medium", c.cls)}>{c.avg}</div>
                <div className="col-span-2 text-right font-sans text-[13px] text-[#64748b]">{c.open}</div>
                <div className="col-span-2 text-right font-sans text-[13px] text-[#64748b]">{c.total}</div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
    </div>
  );
}

function AgentsScreen({ agents, initialSelectedKey }: { agents: HeadieAgentView[], initialSelectedKey?: HeadieAgentKey }) {
  const [selectedAgentKey, setSelectedAgentKey] = useState<HeadieAgentKey>(initialSelectedKey || 'triage');
  const [agentFilter, setAgentFilter] = useState<'all' | 'active' | 'standby'>('all');
  const [agentSearch, setAgentSearch] = useState('');

  const roster = useMemo<HeadieAgentView[]>(() => {
    if (agents.length > 0) return agents;

    return HEADIE_AGENT_ROSTER_BASE.map((seed) => ({
      _id: `agent_${seed.key}`,
      key: seed.key,
      name: seed.name,
      role: seed.role,
      focus: seed.focus,
      status: seed.defaultStatus,
      action: seed.defaultAction,
      last: seed.defaultLast,
    }));
  }, [agents]);

  const filteredRoster = useMemo<HeadieAgentView[]>(() => {
    const query = agentSearch.trim().toLowerCase();
    return roster.filter((agent) => {
      if (agentFilter !== 'all' && agent.status !== agentFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = `${agent.name} ${agent.role} ${agent.focus}`.toLowerCase();
      return searchable.includes(query);
    });
  }, [roster, agentFilter, agentSearch]);

  useEffect(() => {
    if (!filteredRoster.some((agent) => agent.key === selectedAgentKey)) {
      setSelectedAgentKey(filteredRoster[0]?.key ?? roster[0]?.key ?? 'triage');
    }
  }, [filteredRoster, roster, selectedAgentKey]);

  const selectedAgent =
    filteredRoster.find((agent) => agent.key === selectedAgentKey) ??
    roster.find((agent) => agent.key === selectedAgentKey) ??
    roster[0];

  if (!selectedAgent) {
    return null;
  }

  const selectedVisual = HEADIE_AGENT_VISUALS[selectedAgent.key];
  const selectedStatusActive = selectedAgent.status === 'active';
  const activeCount = roster.filter((agent) => agent.status === 'active').length;
  const standbyCount = Math.max(roster.length - activeCount, 0);

  const activityRows = [
    {
      time: '09:42:08',
      tag: 'Signal Refresh',
      tone: 'info',
      text: selectedAgent.action,
    },
    {
      time: '09:44:11',
      tag: 'Drafted Action',
      tone: 'warning',
      text: `Prepared a ${selectedAgent.key === 'dispatch' ? 'release packet' : 'follow-up bundle'} with approval context and confidence notes for founder review.`,
    },
    {
      time: '09:46:33',
      tag: 'Awaiting Decision',
      tone: 'neutral',
      text: 'Waiting on Auth0 Guardian push decision before executing side-effecting actions.',
    },
  ] as const;


  const filterOptions: Array<{ key: 'all' | 'active' | 'standby'; label: string }> = [
    { key: 'all', label: 'All agents' },
    { key: 'active', label: 'Active' },
    { key: 'standby', label: 'Standby' },
  ];

  return (
    <div className="flex flex-col xl:flex-row gap-5 h-[calc(100vh-160px)] w-full max-w-[1240px] mx-auto pb-10">
      <div className="xl:w-[340px] shrink-0 rounded-[22px] border border-[#dbe4ef] bg-white/95 shadow-[0_10px_28px_rgba(15,23,42,0.05)] p-4 flex flex-col gap-3">
        <div className="px-1">
          <div className="text-[11px] font-heading font-semibold text-[#64748b] uppercase tracking-wider">Agent Console</div>
          <div className="text-[17px] font-heading font-medium text-[#334155] mt-0.5">Live orchestration</div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" size={15} />
          <Input
            value={agentSearch}
            onChange={(event) => setAgentSearch(event.target.value)}
            placeholder="Search agent, role, or focus"
            className="h-9 pl-9 rounded-[10px] border-[#dbe4ef] bg-[#fcfdff] text-[12px]"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setAgentFilter(option.key)}
              className={cn(
                'px-3 py-1.5 text-[11px] rounded-full border transition-colors',
                agentFilter === option.key
                  ? 'bg-[#eff6ff] text-[#1d4ed8] border-[#bfdbfe]'
                  : 'bg-white text-[#64748b] border-[#e2e8f0] hover:border-[#cbd5e1] hover:text-[#334155]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] text-[#94a3b8] px-1">
          <span>{filteredRoster.length} shown</span>
          <span>{activeCount} active · {standbyCount} standby</span>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 -mr-1 flex flex-col gap-2">
          {filteredRoster.length === 0 ? (
            <Card className="rounded-[16px] border border-[#e2e8f0] shadow-none bg-[#fcfdff]">
              <CardContent className="p-4 text-center">
                <div className="text-[13px] font-medium text-[#334155]">No agents match this view</div>
                <div className="text-[11px] text-[#94a3b8] mt-1">Try clearing search or switching status filters.</div>
              </CardContent>
            </Card>
          ) : (
            filteredRoster.map((agent) => {
              const isSelected = agent.key === selectedAgent.key;
              const isLive = agent.status === 'active';
              const visual = HEADIE_AGENT_VISUALS[agent.key];

              return (
                <button
                  key={agent._id}
                  type="button"
                  onClick={() => setSelectedAgentKey(agent.key)}
                  className={cn(
                    'relative w-full rounded-[16px] border p-3 text-left transition-all',
                    isSelected
                      ? 'bg-[#fffaf5] border-[#ffedd5] shadow-[0_2px_12px_rgba(225,129,49,0.06)]'
                      : 'bg-white border-[#e2e8f0] hover:border-[#cbd5e1] hover:shadow-[0_4px_12px_rgba(15,23,42,0.04)]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 flex items-center justify-center shrink-0">
                      <img
                        src={isLive || isSelected ? visual.coloredSrc : visual.graySrc}
                        alt={agent.name}
                        className={getHeadieAvatarClass(agent.key, 'w-8 h-8')}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-[#1e293b] truncate">{agent.name}</div>
                      <div className="text-[11px] text-[#64748b] truncate">{agent.role}</div>
                    </div>

                    <Badge className={cn(
                      'text-[10px] uppercase shadow-none border',
                      isLive
                        ? 'bg-[#ecfdf5] text-[#15803d] border-[#bbf7d0]'
                        : 'bg-[#f8fafc] text-[#64748b] border-[#cbd5e1]',
                    )}>
                      {isLive ? 'Live' : 'Standby'}
                    </Badge>
                  </div>

                  <div className="text-[11px] text-[#64748b] mt-2 line-clamp-2">{agent.action}</div>
                  <div className="text-[11px] text-[#94a3b8] mt-1">{agent.last}</div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 rounded-[24px] border border-[#dbe4ef] bg-white shadow-[0_14px_30px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col">
        <div className="px-6 py-5 border-b border-[#e2e8f0] bg-[linear-gradient(115deg,#f8fafc_0%,#eef6ff_52%,#f8fafc_100%)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative w-[64px] h-[64px] flex items-center justify-center shrink-0">
                {selectedStatusActive ? (
                  <span className="absolute inset-2 rounded-full bg-[radial-gradient(circle,rgba(225,129,49,0.35)_0%,rgba(225,129,49,0)_72%)] blur-[7px]" />
                ) : null}
                <img
                  src={selectedStatusActive ? selectedVisual.coloredSrc : selectedVisual.graySrc}
                  alt={selectedAgent.name}
                  className={getHeadieAvatarClass(selectedAgent.key, 'relative z-10 w-[46px] h-[46px]')}
                />
              </div>

              <div className="min-w-0">
                <div className="text-[22px] leading-tight font-heading font-medium text-[#1e293b]">{selectedAgent.name}</div>
                <div className="text-[13px] text-[#475569]">{selectedAgent.role}</div>
                <div className="text-[12px] text-[#64748b] mt-1">{selectedAgent.focus}</div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 min-w-fit">
              <Badge className={cn(
                'text-[10px] uppercase tracking-wider font-semibold shadow-none border px-2 py-0.5',
                selectedStatusActive
                  ? 'bg-[#ecfdf5] text-[#15803d] border-[#bbf7d0]'
                  : 'bg-[#f8fafc] text-[#64748b] border-[#cbd5e1]',
              )}>
                {selectedStatusActive ? 'Active' : 'Standby'}
              </Badge>
              <div className="text-[11px] font-sans text-[#94a3b8] whitespace-nowrap">Last seen {selectedAgent.last.toLowerCase()}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-4 bg-[#fcfdff]">
            {activityRows.map((row, index) => (
              <div key={`${row.time}-${index}`} className="grid grid-cols-[74px_1fr] gap-4 items-start">
                <div className="text-right pt-1 text-[11px] font-mono text-[#94a3b8]">{row.time}</div>
                <div className="rounded-[14px] border border-[#e2e8f0] bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.03)]">
                  <Badge className={cn(
                    'mb-2 text-[10px] uppercase font-sans shadow-none border',
                    row.tone === 'info' && 'bg-[#eff6ff] text-[#1d4ed8] border-[#bfdbfe] hover:bg-[#eff6ff]',
                    row.tone === 'warning' && 'bg-[#fffbeb] text-[#b45309] border-[#fcd34d] hover:bg-[#fffbeb]',
                    row.tone === 'neutral' && 'bg-[#f8fafc] text-[#334155] border-[#cbd5e1] hover:bg-[#f8fafc]',
                  )}>
                    {row.tag}
                  </Badge>
                  <div className="text-[13px] font-sans text-[#334155] leading-relaxed">{row.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
  );
}

function MCPScreen() {
  return (
    <div className="flex flex-col gap-6 max-w-[800px] w-full mx-auto pb-10">
      <div className="p-6 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
        <div className="text-[12px] font-heading font-medium text-[#64748b] uppercase tracking-wider mb-2">MCP Server Endpoint</div>
        <div className="text-[20px] font-mono text-[#0f172a] font-medium bg-white px-4 py-2 rounded-lg border border-[#cbd5e1] mb-4">mcp.net30.app/sse</div>
        <div className="flex gap-3">
          <Button variant="outline" className="bg-white hover:bg-[#f1f5f9] h-8 text-[12px] shadow-sm">Copy URL</Button>
          <Button className="bg-[#e18131] hover:bg-[#c76922] text-white h-8 text-[12px]">Connect Claude</Button>
          <Button className="bg-[#e18131] hover:bg-[#c76922] text-white h-8 text-[12px]">Connect Cursor</Button>
        </div>
      </div>
      
      <div>
        <div className="text-[16px] font-heading font-medium text-[#1e293b] mb-4">Available Tools</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { n: 'list_invoices', d: 'Get all invoices filtered by status or client', t: 'read · Tier 0' },
            { n: 'get_outstanding_total', d: 'Returns total outstanding and overdue amounts', t: 'read · Tier 0' },
            { n: 'get_client_health', d: 'Payment history and health score for a client', t: 'read · Tier 0' },
            { n: 'create_invoice', d: 'Draft and send a new invoice via FreshBooks', t: 'write · CIBA required', ciba: true },
            { n: 'send_payment_reminder', d: 'Trigger a reminder email for an overdue invoice', t: 'write · CIBA required', ciba: true }
          ].map(t => (
            <Card key={t.n} className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <CardContent className="p-4">
                <div className="text-[13px] font-mono font-semibold text-[#0f172a] mb-1">{t.n}</div>
                <div className="text-[12px] font-sans text-[#64748b] mb-3">{t.d}</div>
                <Badge className={cn("text-[10px] uppercase font-sans font-medium px-2 shadow-none", t.ciba ? "bg-[#fef2f2] text-[#e94235] hover:bg-[#fef2f2] border border-[#fca5a5]/30" : "bg-[#f1f5f9] text-[#64748b] hover:bg-[#f1f5f9] border border-[#cbd5e1]")}>{t.t}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function SecurityScreen() {
  const agents = [
    {
      name: 'Billing Brain',
      integrations: 'FreshBooks · Stripe',
      color: 'bg-[#10b981]',
      scopes: [
        { n: 'Read invoices', d: 'Access all invoice records from FreshBooks', t: 'Tier 0', c: 'bg-[#f1f5f9] text-[#64748b]', s: true },
        { n: 'Create invoices', d: 'Draft new invoices; requires CIBA to send', t: 'Tier 2', c: 'bg-[#fffbeb] text-[#d4892a]', s: true },
        { n: 'Send invoices', d: 'Requires push approval before any send', t: 'Tier 2', c: 'bg-[#fffbeb] text-[#d4892a]', s: true },
        { n: 'Stripe payouts', d: 'Read payout status and generate payment links', t: 'Tier 2', c: 'bg-[#fffbeb] text-[#d4892a]', s: false },
        { n: 'Mark as paid', d: 'Requires step-up auth + push approval', t: 'Tier 3', c: 'bg-[#fef2f2] text-[#e94235]', s: false }
      ]
    },
    {
      name: 'Comms Pilot',
      integrations: 'Gmail · Slack',
      color: 'bg-[#3b82f6]',
      scopes: [
        { n: 'Read emails', d: 'Parse billing-related threads from inbox', t: 'Tier 0', c: 'bg-[#f1f5f9] text-[#64748b]', s: true },
        { n: 'Draft replies', d: 'Suggest email drafts directly in Gmail', t: 'Tier 1', c: 'bg-[#fffbeb] text-[#d4892a]', s: true },
        { n: 'Send emails', d: 'Requires step-up auth + push approval', t: 'Tier 3', c: 'bg-[#fef2f2] text-[#e94235]', s: false }
      ]
    }
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[800px] w-full mx-auto pb-10">
      <div className="text-[18px] font-heading font-medium text-[#1e293b] mb-2 border-b border-[#e2e8f0] pb-2">Agent Permissions</div>
      
      {agents.map(agent => (
        <Card key={agent.name} className="rounded-xl border-[#e2e8f0] shadow-sm overflow-hidden mb-2">
          <div className="bg-[#f8fafc] px-5 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("w-2.5 h-2.5 rounded-full shadow-inner", agent.color)} />
              <div className="text-[14px] font-heading font-semibold text-[#1e293b]">{agent.name}</div>
              <span className="text-[11px] text-[#64748b] ml-1">{agent.integrations}</span>
            </div>
          </div>
          <div className="flex flex-col">
            {agent.scopes.map((scope, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-4 border-b border-[#f1f5f9] last:border-0 hover:bg-[#fdfdfd]">
                <div className="flex-1">
                  <div className="text-[13px] font-medium font-sans text-[#334155]">{scope.n}</div>
                  <div className="text-[12px] font-sans text-[#64748b]">{scope.d}</div>
                </div>
                <Badge className={cn("text-[10px] font-sans uppercase font-medium shadow-none mx-4", scope.c)}>{scope.t}</Badge>
                <div className={cn("w-10 h-6 rounded-full flex items-center px-1 cursor-pointer transition-colors shadow-inner", scope.s ? "bg-[#10b981]" : "bg-[#cbd5e1]")}>
                  <div className={cn("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", scope.s ? "translate-x-4" : "translate-x-0")} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="text-[18px] font-heading font-medium text-[#1e293b] mb-2 border-b border-[#e2e8f0] pb-2">Auth0 — Credential Security</div>
      <Card className="rounded-[16px] bg-white border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
        <CardContent className="p-0">
          <div className="bg-[#1e293b] text-white px-5 py-3 rounded-t-xl font-heading text-[14px]">Powered by Auth0 Token Vault + CIBA</div>
          <div className="flex flex-col p-2">
            {[
              { k: 'Credential storage', v: 'Token Vault (RFC 8693)' },
              { k: 'Approval method', v: 'CIBA + Guardian push' },
              { k: 'Transaction context', v: 'RAR (RFC 9396)' },
              { k: 'MCP auth', v: 'OAuth 2.1 + PKCE' },
              { k: 'FreshBooks token', v: 'Stored · never exposed' }
            ].map(r => (
              <div key={r.k} className="flex items-center justify-between px-4 py-2 hover:bg-[#f8fafc] rounded-md transition-colors">
                <div className="text-[13px] font-sans text-[#64748b]">{r.k}</div>
                <div className="text-[13px] font-mono font-medium text-[#1e293b]">{r.v}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeScreen, setActiveScreenState] = useState(resolveScreenFromPath(pathname));
  const [targetAgentKey, setTargetAgentKey] = useState<HeadieAgentKey | null>(null);
  const [isNavigatingScreen, setIsNavigatingScreen] = useState(false);
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const navigationFallbackRef = useRef<NodeJS.Timeout | null>(null);
  const [showCommandCenter, setShowCommandCenter] = useState(false);
  const [query, setQuery] = useState('');
  const [automationQuery, setAutomationQuery] = useState<{ text: string; id: number } | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);

  // Background Cursor Effect — ref-based to avoid React re-renders, localized to Sidebar
  const sidebarGradientRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    const handleMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (sidebarGradientRef.current) {
          sidebarGradientRef.current.style.left = `${e.clientX}px`;
          sidebarGradientRef.current.style.top = `${e.clientY}px`;
        }
      });
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);
  const { user } = useUser();
  const userInitial = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'C';

  const agentsQueryRaw = useQuery(api.agents.listAgents);
  const pendingApprovalsRaw = useQuery(api.approvals.listPendingApprovals, {
    limit: 12,
  });
  
  // Stable query pattern: Prevents flicker by holding onto last known data
  const metricsRaw = useQuery(api.metrics.getDashboardMetrics);
  const [metrics, setMetrics] = useState<any>(null);
  const metricsRef = useRef<any>(null);

  useEffect(() => {
    // Critical: Do NOT set back to null if metricsRaw is null.
    // This maintains the metrics display during Auth identity blips.
    if (metricsRaw) {
      setMetrics(metricsRaw);
      metricsRef.current = metricsRaw;
    }
  }, [metricsRaw]);

  const dashboardLoading = metricsRaw === undefined && metrics === null;
  
  const candidatesInPipeline = metrics?.candidatesInPipeline ?? 0;
  const openRoles = metrics?.openRoles ?? 0;
  const avgDaysToFirstInterview = metrics?.avgDaysToFirstInterview ?? 0;
  const interviewsThisWeek = metrics?.interviewsThisWeek ?? 0;
  const offersPendingApproval = metrics?.offersPendingApproval ?? 0;
  const candidatesNeedingFollowUp = metrics?.candidatesNeedingFollowUp ?? 0;

  const agentsQuery = useMemo(() => agentsQueryRaw ?? [], [agentsQueryRaw]);
  const [agents, setAgents] = useState<any[]>([]);
  const pendingApprovals = useMemo<PendingApprovalDoc[]>(
    () => pendingApprovalsRaw ?? [],
    [pendingApprovalsRaw],
  );
  const [selectedApprovalId, setSelectedApprovalId] = useState<Id<'pendingApprovals'> | null>(null);
  const [dashboardSelectedAgentId, setDashboardSelectedAgentId] = useState<string | null>(null);
  const [cardDisplayAgentId, setCardDisplayAgentId] = useState<string | null>(null);
  const [isAgentSwitching, setIsAgentSwitching] = useState(false);
  const [carouselPausedUntil, setCarouselPausedUntil] = useState<number>(0);

  useEffect(() => {
    if (pendingApprovals.length === 0) {
      setSelectedApprovalId(null);
      return;
    }

    if (
      selectedApprovalId &&
      !pendingApprovals.some((approval) => approval._id === selectedApprovalId)
    ) {
      setSelectedApprovalId(null);
    }
  }, [pendingApprovals, selectedApprovalId]);

  const selectedApproval = selectedApprovalId
    ? pendingApprovals.find((approval) => approval._id === selectedApprovalId)
    : null;

  const nextApprovalExpiryLabel = useMemo(() => {
    const earliestExpiry = pendingApprovals
      .map((approval) => approval.expiresAtMs)
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b)[0];

    return typeof earliestExpiry === 'number'
      ? formatExpiry(earliestExpiry)
      : 'No expiry';
  }, [pendingApprovals]);

  const agentRoster = useMemo<HeadieAgentView[]>(() => {
    const mappedByKey = new Map<HeadieAgentKey, any>();

    for (const agent of agents) {
      mappedByKey.set(resolveHeadieAgentKey(agent.name), agent);
    }

    return HEADIE_AGENT_ROSTER_BASE.map((seed) => {
      const queryAgent = mappedByKey.get(seed.key);

      return {
        _id: queryAgent?._id ?? `agent_${seed.key}`,
        key: seed.key,
        name: queryAgent?.name ?? seed.name,
        role: seed.role,
        focus: seed.focus,
        status: queryAgent ? 'active' : seed.defaultStatus,
        action: queryAgent?.action ?? seed.defaultAction,
        last: queryAgent?.last ?? seed.defaultLast,
      };
    });
  }, [agents]);

  const activeAgentCount = useMemo(
    () => agentRoster.filter((agent) => agent.status === 'active').length,
    [agentRoster],
  );

  // Initial and reactive sync for card display
  useEffect(() => {
    if (agentRoster.length > 0) {
      // If no agent is selected for display, OR the currently selected one vanished (e.g. ID changed from static to Convex)
      const currentExists = agentRoster.some(ag => ag._id === cardDisplayAgentId);
      if (!cardDisplayAgentId || !currentExists) {
        setCardDisplayAgentId(agentRoster[0]?._id);
      }
    }
  }, [agentRoster, cardDisplayAgentId]);

  // Automated Staggered Carousel for Agents Activity card
  useEffect(() => {
    // Only run on the dashboard and if we have agents to cycle through
    if (activeScreen !== 'dashboard' || agentRoster.length <= 1) return;

    const intervalId = setInterval(() => {
      // If the user manually interacted recently, skip the automated cycle
      if (Date.now() < carouselPausedUntil) return;

      // 1. Switch Avatar Highlight FIRST
      setDashboardSelectedAgentId((currentId) => {
        const effectiveId = currentId || agentRoster[0]?._id;
        const currentIndex = agentRoster.findIndex(ag => ag._id === effectiveId);
        const nextIndex = (currentIndex + 1) % agentRoster.length;
        const nextId = agentRoster[nextIndex]._id;

        // 2. Schedule the card switch with a shorter delay (Snappier Staggered Effect)
        setTimeout(() => {
          // Trigger "Blur Fade Out" for the card
          setIsAgentSwitching(true);

          // Wait for the fade-out to complete before switching the card data
          setTimeout(() => {
            setCardDisplayAgentId(nextId);
            setIsAgentSwitching(false); // Trigger "Blur Fade In"
          }, 150);
        }, 150); // Reduced from 400ms to 150ms for a tighter transition

        return nextId;
      });
    }, 2000);

    return () => clearInterval(intervalId);
  }, [activeScreen, agentRoster, setDashboardSelectedAgentId, carouselPausedUntil]);

  // Sync agents state once from query (only when empty, avoids flicker)
  useEffect(() => {
    if (agentsQuery.length > 0 && agents.length === 0) {
      setAgents(agentsQuery);
    }
  }, [agentsQuery, agents.length]);
  const [toast, setToast] = useState('');
  const [activeTask, setActiveTask] = useState<any>(null);

  useEffect(() => {
    setActiveScreenState(resolveScreenFromPath(pathname));
    setIsNavigatingScreen(false);

    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }

    if (navigationFallbackRef.current) {
      clearTimeout(navigationFallbackRef.current);
      navigationFallbackRef.current = null;
    }
  }, [pathname]);

  const setActiveScreen = (screen: string) => {
    const nextPath = resolvePathFromScreen(screen);
    if (nextPath === pathname || isNavigatingScreen) {
      return;
    }

    setIsNavigatingScreen(true);
    
    // Snappier transition timing: allow exit animation to begin before routing
    navigationTimeoutRef.current = setTimeout(() => {
      router.push(nextPath);
    }, SCREEN_EXIT_TRANSITION_MS);


    // If navigation fails for any reason, recover the current panel visibility.
    navigationFallbackRef.current = setTimeout(() => {
      setIsNavigatingScreen(false);
      navigationFallbackRef.current = null;
    }, SCREEN_NAVIGATION_FALLBACK_MS);
  };

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }

      if (navigationFallbackRef.current) {
        clearTimeout(navigationFallbackRef.current);
      }
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  };

  const activeTaskAgentKey = resolveHeadieAgentKey(activeTask?.agent);
  const activeTaskAgentSeed = findHeadieSeed(activeTaskAgentKey);
  const activeTaskAgentVisual = HEADIE_AGENT_VISUALS[activeTaskAgentKey];

  const handleCommand = (cmdText: string) => {
    setShowCommandCenter(false);
    
    setActiveTask({
      query: cmdText,
      agent: 'Triage Agent',
      resources: ['Role: Senior Product Designer', 'Candidate: Anya Sharma'],
      steps: [
        { msg: 'Analyzing prompt intent', done: true },
        { msg: 'Gathering candidate and job context', done: true },
        { msg: 'Drafting outreach and scheduling actions', done: false },
        { msg: 'Awaiting your approval (CIBA push)', done: false }
      ],
      status: 'running'
    });

    setTimeout(() => {
      setAgents((prevAgents) => [{
        _id: `agent_live_${Date.now()}`,
        id: Date.now(),
        name: 'Analyst Agent',
        action: `Synthesizing queue deltas for: ${cmdText}`,
        files: [],
        last: 'Last action just now',
      }, ...prevAgents]);
    }, 1500);
  };

  const handleDashboardSend = () => {
    if (!query.trim()) return;
    setAutomationQuery({ text: query, id: Date.now() });
    setActiveScreenState('workflows');
    setQuery('');
  };

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌥K
      if (e.key === 'k' && e.altKey) {
        e.preventDefault();
        setShowCommandCenter(open => !open);
      }
      // ⌥N: New job brief
      if (e.key === 'n' && e.altKey) {
        e.preventDefault();
        handleCommand('Create new job brief');
      }
      // ⌥R: Candidate follow-ups
      if (e.key === 'r' && e.altKey) {
        e.preventDefault();
        handleCommand('Draft candidate follow-ups');
      }
      // ⌥F: Funnel forecast
      if (e.key === 'f' && e.altKey) {
        e.preventDefault();
        handleCommand('Generate hiring funnel forecast');
      }
      
      if (e.key === 'Escape') {
        setShowCommandCenter(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-full bg-[#f4f5f7] font-sans overflow-hidden select-none relative z-0">
      
      {/* Dynamic Cursor Gradient (Base Layer) */}
      <div 
        ref={sidebarGradientRef}
        className="absolute w-[1400px] h-[1400px] rounded-full pointer-events-none z-[-1]"
        style={{
          background: 'radial-gradient(circle, rgba(225, 129, 49, 0.1) 0%, transparent 60%)',
          left: -1000,
          top: -1000,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(150px)',
          willChange: 'left, top',
          transition: 'left 80ms ease-out, top 80ms ease-out'
        }}
      />
      
      {/* Toast Notification (Sonar Style) */}
      <div className={cn(
        "fixed bottom-8 right-8 z-[1000] bg-[#1f3347] text-white px-5 py-4 rounded-xl shadow-[0_15px_30px_rgba(0,0,0,0.15)] text-sm font-medium transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-none flex items-start gap-3.5 font-sans min-w-[320px] border border-white/5",
        toast ? "translate-y-0 opacity-100 scale-100" : "translate-y-[20px] opacity-0 scale-95"
      )}>
        <div className="mt-0.5"><CheckCircle2 size={18} className="text-[#10b981]" /></div>
        <div className="flex flex-col flex-1">
          <span className="text-white font-semibold text-[13px]">{toast.split('|')[0] || toast}</span>
          {toast.includes('|') && <span className="text-[#a0afbb] text-[12px] mt-0.5">{toast.split('|')[1]}</span>}
        </div>
      </div>

      {/* Agent Task Drawer */}
      <div 
        className={cn(
          "fixed top-0 right-0 h-full w-[380px] bg-white shadow-[-10px_0_40px_rgba(0,0,0,0.08)] border-l border-[#e2e8f0] z-[100] transform transition-transform duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col font-sans",
          (activeTask && activeTask.status === 'running') ? "translate-x-0" : "translate-x-full"
        )}
      >
        {activeTask && (
          <>
            <div className="bg-[#f8fafc] border-b border-[#e2e8f0] px-6 py-5 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#3b82f6] animate-pulse"></div>
                  <span className="text-[11px] font-heading text-[#64748b] uppercase tracking-wider font-semibold">Agent Active</span>
                </div>
                <div className="text-[16px] font-semibold text-[#1e293b] leading-tight">{activeTask.query}</div>
              </div>
              <button 
                onClick={() => {
                  setActiveTask({...activeTask, status: 'collapsed'});
                  showToast(`Task backgrounded | ${activeTask.query}`);
                }}
                className="text-[#94a3b8] hover:text-[#334155] p-1.5 rounded-lg hover:bg-[#e2e8f0] transition-colors"
                title="Run in background"
              >
                <ChevronDown size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
              <div className="flex flex-col gap-2">
                <div className="text-[12px] font-medium text-[#64748b]">Assigned Agent</div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#f0f2f5] border border-[#e2e8f0]">
                  <div className="w-10 h-10 flex items-center justify-center shrink-0">
                    <img
                      src={activeTaskAgentVisual.coloredSrc}
                      alt={activeTask.agent}
                      className={getHeadieAvatarClass(activeTaskAgentKey, 'w-7 h-7')}
                    />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-[#334155]">{activeTask.agent}</div>
                    <div className="text-[11px] text-[#64748b]">{activeTaskAgentSeed.role}</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-[12px] font-medium text-[#64748b]">Granted Access Context</div>
                <div className="flex flex-wrap gap-2">
                  {activeTask.resources.map((r: string, i: number) => (
                    <Badge key={i} className="bg-white border-[#cbd5e1] text-[#64748b] hover:bg-[#f8fafc] rounded-md px-2.5 py-1 text-[11px] font-medium shadow-sm flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></div>
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-2">
                <div className="text-[12px] font-medium text-[#64748b] mb-1">Execution Timeline</div>
                {activeTask.steps.map((step: any, idx: number) => (
                  <div key={idx} className="flex gap-4 relative">
                    {idx !== activeTask.steps.length - 1 && <div className="absolute left-[9px] top-6 bottom-[-16px] w-[2px] bg-[#e2e8f0]"></div>}
                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 border-2 bg-white", step.done ? "border-[#10b981] text-[#10b981]" : "border-[#cbd5e1] text-transparent")}>
                      {step.done && <CheckCircle2 size={12} strokeWidth={3} />}
                    </div>
                    <div className={cn("text-[13px] pt-0.5 pb-4", step.done ? "text-[#334155] font-medium" : "text-[#94a3b8]")}>
                      {step.msg}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 border-t border-[#e2e8f0] bg-[#f8fafc]">
              <Button className="w-full bg-[#e18131] hover:bg-[#c76922] text-white" onClick={() => {
                  setActiveTask({...activeTask, status: 'collapsed'});
                  showToast(`Task dismissed | ${activeTask.query}`);
              }}>Hide Panel</Button>
            </div>
          </>
        )}
      </div>

      {/* Sidebar Static (Left Column) */}
      <div className={cn(
        "flex flex-col h-full shrink-0 z-10 sticky top-0 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] bg-transparent overflow-hidden relative",
        isSidebarOpen ? "w-[260px] px-3 pt-[35px]" : "w-[68px] px-1.5 pt-[35px] items-center"
      )}>
        
        {/* Logo & Collapse */}
        <div className="flex items-center mb-5 w-full">
          {isSidebarOpen ? (
            <div className="flex items-center justify-between w-[220px] mx-auto">
              <div className="flex items-center gap-2.5 cursor-pointer ml-1" onClick={() => window.location.href='/'}>
                <img src="/assets/headie.png" alt="Headhunt" className="w-[30px] h-[30px] object-contain drop-shadow-sm" />
                <span className="font-display text-[24px] tracking-[-0.02em] text-[#304f67] leading-none mt-0.5">
                  Headhunt
                </span>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="text-[#94a3b8] hover:text-[#334155] p-1.5 rounded-[10px] hover:bg-white/60 transition-colors shrink-0 -mr-1">
                <PanelLeftClose size={18} className="text-[#94a3b8]" />
              </button>
            </div>
          ) : (
            <div className="flex w-full justify-center px-0">
               <button onClick={() => setIsSidebarOpen(true)} title="Expand Sidebar" className="p-1.5 rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors shrink-0 outline-none">
                 <img src="/assets/headie.png" alt="Logo" className="w-[24px] h-[24px] object-contain drop-shadow-sm pointer-events-none" />
               </button>
            </div>
          )}
        </div>

        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#d6dce1] to-transparent mb-5 opacity-60 shrink-0"></div>

        {/* Team Switcher using Shadcn DropdownMenu */}
        <div className={cn("relative mb-5 shrink-0 flex justify-center", isSidebarOpen ? "w-full px-1" : "w-11 mx-auto px-0")}>
          <DropdownMenu open={teamOpen} onOpenChange={setTeamOpen}>
            <DropdownMenuTrigger asChild>
              <div title={!isSidebarOpen ? "Talent Org" : undefined} className={cn("flex items-center rounded-[12px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)] border border-[#e2e8f0] cursor-pointer hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:border-[#cbd5e1] overflow-hidden", isSidebarOpen ? "gap-3 px-3 py-2.5 min-h-[54px] w-[220px]" : "justify-center w-11 h-11 p-0")}>
                <div className={cn("rounded-[10px] bg-gradient-to-b from-[#f9a865] to-[#e18131] flex items-center justify-center text-white relative shrink-0", isSidebarOpen ? "w-10 h-10 shadow-[inset_0_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(225,129,49,0.3)]" : "w-[36px] h-[36px]")}>
                  <div className="w-5 h-5 border-2 border-white rounded-full flex items-center justify-center">
                    <div className="w-[2px] h-2.5 bg-white rounded-full -mt-1" />
                  </div>
                </div>
                
                {isSidebarOpen && (
                  <>
                    <div className="min-w-0 flex flex-1 flex-col justify-center whitespace-nowrap leading-tight">
                      <span className="text-[11px] font-sans font-medium text-[#94a3b8] mb-0.5 tracking-wide leading-[1.25] truncate">Acme Inc</span>
                      <span className="text-[14px] font-sans font-semibold text-[#334155] leading-[1.2] truncate">Talent Org</span>
                    </div>
                    <div className="text-[#a0afbb] shrink-0">
                      <ChevronsUpDown size={14} />
                    </div>
                  </>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[220px] mt-1 bg-white border-[#d6dce1] rounded-[14px] shadow-[0_10px_30px_rgba(0,0,0,0.08)] font-sans" align="center">
              <DropdownMenuLabel className="px-3 py-1.5 text-[10px] font-medium text-[#a0afbb] uppercase tracking-wider font-sans">Organizations</DropdownMenuLabel>
              <DropdownMenuItem className="px-2 py-2 flex items-center gap-3 cursor-pointer mx-1 rounded-lg bg-[#f0f2f5] focus:bg-[#f0f2f5]">
                <div className="w-7 h-7 rounded-md bg-[#e18131] text-white flex items-center justify-center text-[10px] font-medium shadow-sm">PT</div>
                <div className="flex-1 text-[13px] font-sans font-medium text-[#0f172a]">Project Team</div>
              </DropdownMenuItem>
              <DropdownMenuItem className="px-2 py-2 flex items-center gap-3 cursor-pointer mx-1 rounded-lg focus:bg-[#f8f9fa]">
                <div className="w-7 h-7 rounded-md bg-[#f8fafc] border border-[#d6dce1] text-[#64748b] flex items-center justify-center text-[10px] font-medium shadow-sm"><Plus size={14}/></div>
                <div className="flex-1 text-[13px] font-sans text-[#64748b]">Create Team</div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#d6dce1] to-transparent mb-2 opacity-60 shrink-0"></div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 w-full flex flex-col pt-1">
          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-1">Recruiting</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-1" />}
          <NavItem onClick={() => setActiveScreen('dashboard')} icon={<Home size={18} />} label="Dashboard" active={activeScreen === 'dashboard'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('jobs')} icon={<Jobs size={18} />} label="Jobs" active={activeScreen === 'jobs'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('pipeline')} icon={<CircleDollarSign size={18} />} label="Pipeline" active={activeScreen === 'pipeline'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('candidates')} icon={<MessageSquare size={18} />} label="Candidates" active={activeScreen === 'candidates'} isSidebarOpen={isSidebarOpen} />
          
          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-4">Workflows</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-4" />}
          <NavItem onClick={() => setActiveScreen('workflows')} icon={<Zap size={18} />} label="Chat with Headie" active={activeScreen === 'workflows'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('agents')} icon={<Bot size={18} />} label="Agents" active={activeScreen === 'agents'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('approvals')} icon={<Copy size={18} />} label="Approvals" active={activeScreen === 'approvals'} badge={2} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('audit')} icon={<HistoryIcon size={18} />} label="Audit Trail" active={activeScreen === 'audit'} isSidebarOpen={isSidebarOpen} />

          {isSidebarOpen && <div className="text-[11px] font-sans font-medium text-[#8e9caf] uppercase tracking-wider mb-2 px-3 py-1 mt-4">Org & App</div>}
          {!isSidebarOpen && <div className="w-6 mx-auto border-t border-[#d6dce1] opacity-60 mb-3 mt-4" />}
          <NavItem onClick={() => setActiveScreen('team')} icon={<Users size={18} />} label="Team" active={activeScreen === 'team'} isSidebarOpen={isSidebarOpen} />
          <NavItem onClick={() => setActiveScreen('settings')} icon={<Settings size={18} />} label="Settings" active={activeScreen === 'settings'} isSidebarOpen={isSidebarOpen} />
        </nav>
        
        {/* Footer */}
        <div className="mt-auto px-1 flex w-full justify-center mb-4">
          <div title={!isSidebarOpen ? "Built with Auth0" : undefined} className={cn("flex items-center p-3 bg-[#0a0a0a] border border-[#222] rounded-xl hover:bg-black cursor-pointer overflow-hidden transition-all shadow-md group", isSidebarOpen ? "gap-2.5 w-[220px]" : "w-11 h-11 justify-center mx-auto")}>
            <div className="shrink-0 text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-all">
              <svg width="22" height="26" viewBox="0 -1 26 34" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M 1.68935,13.6673 C 6.93599,12.8036 11.0479,8.69124 11.912,3.4446 l 0.4204,-2.5514 c 0.0807,-0.4935 -0.3246,-0.929 -0.8236,-0.8909 C 7.51403,0.3114 3.74928,1.634 1.67011,2.4864 0.660431,2.9009 0,3.8821 0,4.9742 V 13.039 c 0,0.4744 0.424115,0.8353 0.892565,0.7584 z" fill="currentColor"/>
                <path d="m 14.4422,3.4442 c 0.8637,5.2467 4.9761,9.3586 10.2227,10.2227 l 0.7968,0.1305 c 0.4684,0.077 0.8926,-0.284 0.8926,-0.7583 V 4.9742 c 0,-1.0925 -0.6605,-2.0733 -1.6701,-2.4878 C 22.605,1.6323 18.8386,0.3115 14.8454,0.0024 14.3465,-0.0361 13.9395,0.3981 14.0219,0.8933 Z" fill="currentColor"/>
                <path d="m 24.665,16.1959 c -5.2466,0.8637 -9.3585,4.976 -10.2227,10.2227 l -0.524,4.9797 c -0.0481,0.4493 0.4513,0.7659 0.8273,0.5145 0.0038,-0.0021 0.0058,-0.0038 0.0096,-0.0058 3.2905,-2.2193 10.7965,-8.0285 11.5394,-15.2849 0.0364,-0.3572 -0.2803,-0.6487 -0.6337,-0.5914 l -0.9946,0.1631 z" fill="currentColor"/>
                <path d="M 11.9135,26.4136 C 11.0498,21.167 6.93746,17.055 1.69082,16.1909 L 0.621329,16.0144 C 0.30638,15.9625 0.024473,16.2235 0.05501,16.5423 0.759355,23.8392 8.36917,29.6848 11.6885,31.9079 c 0.3438,0.2283 0.7984,-0.0461 0.7545,-0.4568 z" fill="currentColor"/>
              </svg>
            </div>
            {isSidebarOpen && (
               <div className="flex flex-col -mt-0.5">
                 <span className="text-[10px] text-[#8e9caf] font-bold uppercase tracking-wider leading-tight">Secured & Built with</span>
                 <span className="text-[13px] text-white font-bold leading-tight tracking-[0.01em]">Auth0 by Okta</span>
               </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Main Content Area (Scrolling Container) */}
      <div className="flex-1 flex flex-col pt-3 pr-3 pb-3 overflow-hidden">
        
        {/* The White Rounded Dashboard Box */}
        <div className="flex-1 bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.03)] border border-[#e2e8f0] flex flex-col overflow-hidden relative">
          
          {/* Topbar static inside the white box */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-[#f1f5f9] bg-white z-10 w-full shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-heading text-[#334155] capitalize">{activeScreen}</span>
              <span className="text-[#cbd5e1]">/</span>
              <span className="text-[14px] font-sans text-[#94a3b8]">Overview</span>
            </div>
            <div className="flex items-center gap-3">
              {activeScreen !== 'dashboard' && <CommandMenuWrapper />}
              <Button variant="outline" size="icon" className="w-8 h-8 rounded-full border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc] hover:text-[#334155]">
                <Bell size={16} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#3a3a4a] to-[#2a2a36] flex items-center justify-center text-white text-[11px] font-medium font-sans shadow-sm cursor-pointer ml-2 hover:opacity-80 transition-opacity">
                    {userInitial}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[120px] p-1.5 rounded-xl border-[#d6dce1] shadow-[0_4px_16px_rgba(0,0,0,0.06)] font-sans">
                  <DropdownMenuItem
                    className="text-[13px] rounded-md cursor-pointer text-[#334155] focus:bg-[#f8fafc]"
                    onClick={() => setActiveScreen('workflows')}
                  >
                    Open Chat
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-[13px] rounded-md cursor-pointer text-[#334155] focus:bg-[#f8fafc]"
                    onClick={() => window.location.href = '/login'}
                  >
                    Login Page
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-[13px] rounded-md cursor-pointer text-[#334155] focus:bg-[#f8fafc]"
                    onClick={() => window.location.href = '/auth/login?prompt=login&max_age=0'}
                  >
                    Switch Account
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="text-[13px] rounded-md cursor-pointer text-[#e94235] focus:bg-[#fef2f2] focus:text-[#e94235]"
                    onClick={() => window.location.href = '/logout'}
                  >
                    Log Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Scrolling Page Content */}
          <div className={cn("flex-1 flex flex-col hide-scrollbar bg-white", 
            activeScreen === 'dashboard' ? 'overflow-hidden' : 'overflow-y-auto',
            activeScreen === 'assistant' || activeScreen === 'workflows' ? "p-0" : "pt-8 px-10 pb-6 min-w-[700px]"
          )}>
            <div className={cn(isNavigatingScreen ? "animate-blur-fade-out pointer-events-none" : hasMounted ? "animate-blur-fade-in" : "", "w-full h-full flex flex-col min-h-0")}>
              {activeScreen === 'dashboard' && (
              <div className="max-w-[800px] mx-auto w-full h-full flex flex-col min-h-0">
                
                {/* Centered Hero & Command Section */}
                <div className="flex flex-col items-center w-full mb-6 text-center">
                  
                  <div className="mb-10 w-full max-w-[900px]">
                    {dashboardLoading ? (
                      <div className="animate-pulse">
                        {/* Row 1: "You have [X candidates in motion]" */}
                        <div className="flex flex-wrap justify-center items-center gap-3 leading-[1.5]">
                          <div className="h-[48px] w-[180px] bg-[#f1f5f9] rounded-lg" />
                          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#f8fafc] border border-[#e2e8f0] h-[56px] w-[260px]" />
                        </div>
                        {/* Row 2: "across [X roles], averaging" */}
                        <div className="flex flex-wrap justify-center items-center gap-3 mt-3 leading-[1.5]">
                          <div className="h-[48px] w-[120px] bg-[#f1f5f9] rounded-lg" />
                          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#f8fafc] border border-[#e2e8f0] h-[56px] w-[200px]" />
                          <div className="h-[48px] w-[180px] bg-[#f1f5f9] rounded-lg" />
                        </div>
                        {/* Row 3: "[XX days] to first interview." */}
                        <div className="flex flex-wrap justify-center items-center gap-3 mt-3 leading-[1.5]">
                          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#f8fafc] border border-[#e2e8f0] h-[56px] w-[190px]" />
                          <div className="h-[48px] w-[160px] bg-[#f1f5f9] rounded-lg" />
                        </div>
                        {/* Sub-stats row */}
                        <div className="flex justify-center items-center gap-8 pt-6">
                          <div className="h-3 w-[120px] bg-[#f1f5f9] rounded" />
                          <div className="h-3 w-[150px] bg-[#f1f5f9] rounded" />
                          <div className="h-3 w-[100px] bg-[#f1f5f9] rounded" />
                        </div>
                      </div>
                    ) : (
                    <>
                    <div className="text-[38px] md:text-[48px] font-display font-medium leading-[1.6] md:leading-[1.5] tracking-[-0.02em] text-[#94a3b8]">
                      You have{" "}
                      <span className="inline-flex items-center gap-2.5 px-4 py-2 mx-1 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] border border-[#e2e8f0] align-middle -translate-y-1 transition-all duration-300 hover:scale-[1.03] cursor-pointer hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-[#cbd5e1]">
                        <span className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-full bg-[#fffbeb] text-[#f59e0b]"><MessageSquare size={20} strokeWidth={2.5} /></span>
                        <span className="font-sans text-[#b45309] font-semibold text-[24px] md:text-[32px] tracking-tight leading-none pb-[2px]"><AnimatedNumber value={candidatesInPipeline} suffix="candidates" delay={100} /></span>
                      </span>
                      <br className="hidden md:block" />
                      across{" "}
                      <span className="inline-flex items-center gap-2.5 px-4 py-2 mx-1 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] border border-[#e2e8f0] align-middle -translate-y-1 transition-all duration-300 hover:scale-[1.03] cursor-pointer hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-[#cbd5e1]">
                        <span className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-full bg-[#eef2ff] text-[#4338ca]"><Roles size={20} strokeWidth={2.5} /></span>
                        <span className="font-sans text-[#4338ca] font-semibold text-[24px] md:text-[32px] tracking-tight leading-none pb-[2px]"><AnimatedNumber value={openRoles} suffix="roles" delay={200} /></span>
                      </span>
                      , averaging{" "}
                      <br className="hidden md:block" />
                      <span className="inline-flex items-center gap-2.5 px-4 py-2 mx-1 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] border border-[#e2e8f0] align-middle -translate-y-1 transition-all duration-300 hover:scale-[1.03] cursor-pointer hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-[#cbd5e1]">
                        <span className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-full bg-[#e0f2fe] text-[#0369a1]"><Clock size={20} strokeWidth={2.5} /></span>
                        <span className="font-sans text-[#0369a1] font-semibold text-[24px] md:text-[32px] tracking-tight leading-none pb-[2px]"><AnimatedNumber value={avgDaysToFirstInterview} suffix="days" delay={300} padZero /></span>
                      </span>{" "}
                      to first interview.
                    </div>
                    <div className="flex flex-wrap justify-center items-center gap-8 pt-6 pb-0 text-[13px] font-sans text-[#94a3b8]">
                      <span className="flex items-center"><span className="text-[#334155] font-semibold mr-1.5">{interviewsThisWeek}</span> interviews this week</span>
                      <span className="flex items-center"><span className="text-[#334155] font-semibold mr-1.5">{offersPendingApproval}</span> offers pending approval</span>
                      <span className="flex items-center"><span className="text-[#334155] font-semibold mr-1.5">{candidatesNeedingFollowUp}</span> candidates need follow-up</span>
                    </div>
                    </>
                    )}
                  </div>
                  
                  {/* Clean Simple Command Bar & Marquee */}
                  <div className="w-full max-w-[640px]">
                    <style>{`
                      @keyframes marquee {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                      }
                      .animate-marquee {
                        display: flex;
                        width: max-content;
                        animation: marquee 35s linear infinite;
                      }
                      .animate-marquee:hover {
                        animation-play-state: paused;
                      }
                      .mask-edges {
                        mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
                        -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
                      }
                    `}</style>
                    <div 
                      className="flex items-center gap-3 w-full bg-white border border-[#cbd5e1] focus-within:border-[#94a3b8] transition-all duration-300 rounded-[100px] p-2 pl-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] focus-within:shadow-[0_8px_30px_rgba(0,0,0,0.08)] group relative"
                    >
                      <Search size={22} className="text-[#94a3b8] group-focus-within:text-[#64748b] transition-colors shrink-0" />
                      <Input 
                        placeholder="Ask Headie to summarize replies, schedule loops, and draft follow-ups..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleDashboardSend();
                        }}
                        className="flex-1 bg-transparent border-none outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-[16px] text-[#334155] placeholder:text-[#94a3b8] font-sans h-auto px-0 shadow-none min-w-[200px]"
                      />
                      <div className="flex items-center gap-2.5 shrink-0 hidden sm:flex">
                        <div 
                          onClick={() => setShowCommandCenter(true)}
                          className="bg-[#f8fafc] text-[#94a3b8] border border-[#e2e8f0] px-3 py-1.5 rounded-[10px] text-[13px] font-sans font-medium shadow-sm flex items-center justify-center min-w-[36px] cursor-pointer hover:bg-[#f1f5f9] transition-colors"
                          title="Open Command Center"
                        >
                          ⌘K
                        </div>
                        <Button 
                          onClick={handleDashboardSend}
                          className="bg-gradient-to-b from-[#f9a865] to-[#e18131] hover:from-[#f9a865] hover:to-[#c76922] text-white px-7 py-3 h-[44px] rounded-full text-[14px] font-sans font-medium transition-all active:scale-95 flex items-center justify-center gap-2 shadow-[inset_0_1px_rgba(255,255,255,0.4),0_6px_16px_rgba(225,129,49,0.3)] border border-[#d27527]"
                        >
                          Send <ArrowRight size={16} />
                        </Button>
                      </div>
                    </div>

                    {/* Marquee Suggestions */}
                    <div className="relative w-[96%] mx-auto mt-6 overflow-hidden mask-edges pb-4">
                      <div className="animate-marquee gap-3 py-1">
                        {[...['Summarize new applicants', 'Draft candidate follow-ups', 'Schedule next-round interviews', 'Generate interviewer digest', 'Prepare offer packet'], ...['Summarize new applicants', 'Draft candidate follow-ups', 'Schedule next-round interviews', 'Generate interviewer digest', 'Prepare offer packet']].map((chip, idx) => (
                          <Badge 
                            key={`${chip}-${idx}`}
                            variant="secondary"
                            onClick={(e) => { e.stopPropagation(); handleCommand(chip); }}
                            className="text-[13px] px-5 py-2.5 rounded-full bg-white border border-[#cbd5e1]/60 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#334155] hover:border-[#94a3b8] font-sans font-medium transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.02)] cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {chip}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Approvals + Agents Mission Grid */}
                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-8 pb-4">
                  <div className="w-full h-full flex flex-col min-h-0">
                    <Card className="rounded-[24px] border border-[#dbe4ef] bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)] h-full flex flex-col">
                      <div className="px-5 py-3 border-b border-[#e2e8f0] bg-[linear-gradient(120deg,#f8fafc_0%,#fff7ed_42%,#f8fafc_100%)] rounded-t-[24px]">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <div className="text-[12px] text-[#94a3b8] uppercase tracking-wider font-heading">Needs your approval</div>
                            <div className="text-[15px] font-medium text-[#334155] mt-0.5">Guardian-gated actions queued for founder decision</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className="text-[10px] font-sans uppercase tracking-wider bg-[#fef2f2] text-[#e94235] border border-[#fecaca] shadow-none">
                              {pendingApprovals.length} pending
                            </Badge>
                            {pendingApprovals.length > 0 ? (
                              <Badge className="text-[10px] font-sans uppercase tracking-wider bg-[#fffbeb] text-[#b45309] border border-[#fde68a] shadow-none">
                                next expiry {hasMounted ? nextApprovalExpiryLabel : '--'}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <CardContent className="p-4 md:p-5 flex-1 overflow-y-auto">
                        {pendingApprovalsRaw === undefined ? (
                          <div className="flex flex-col gap-3">
                            {Array.from({ length: 2 }).map((_, idx) => (
                              <Card key={idx} className="rounded-[18px] border border-[#e2e8f0] bg-white">
                                <CardContent className="p-4">
                                  <div className="h-4 w-1/2 bg-[#f1f5f9] rounded mb-2" />
                                  <div className="h-3 w-2/3 bg-[#f8fafc] rounded" />
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        ) : pendingApprovals.length === 0 ? (
                          <Card className="rounded-[18px] bg-[#fcfdff] border border-[#e2e8f0] shadow-none h-full justify-center flex flex-col">
                            <CardContent className="p-6 text-center">
                              <div className="w-12 h-12 rounded-full bg-[#f1f5f9] text-[#94a3b8] mx-auto mb-3 flex items-center justify-center">
                                <CheckCircle2 size={20} />
                              </div>
                              <div className="text-[15px] font-medium font-sans text-[#334155] mb-1">Queue is clear</div>
                              <div className="text-[13px] font-sans text-[#94a3b8]">
                                New protected actions will appear here with full context and agent routing.
                              </div>
                            </CardContent>
                          </Card>
                        ) : (
                          <div className="flex flex-col h-full gap-4">
                            <div className="flex flex-wrap justify-center gap-6 pb-2 items-center px-2">

                              {/* Approvals Horizontal List */}
                              {pendingApprovals.map((approval) => {
                                const candidate = parseApprovalCandidate(approval.payloadJson);
                                const isSelected = selectedApproval?._id === approval._id;
                                const agentKey = resolveApprovalAgentKey(approval, candidate);
                                const agentSeed = findHeadieSeed(agentKey);
                                const agentVisual = HEADIE_AGENT_VISUALS[agentKey];
                                
                                // Safe urgency check for hydration
                                const urgency = hasMounted 
                                  ? resolveApprovalUrgency(approval.expiresAtMs)
                                  : { label: 'Pending', className: 'bg-[#ecfeff] text-[#0e7490] border border-[#a5f3fc] shadow-none text-[10px] uppercase' };

                                return (
                                  <button
                                    key={approval._id}
                                    type="button"
                                    onClick={() => setSelectedApprovalId(approval._id)}
                                    aria-label={`Review ${toActionLabel(candidate.actionType ?? approval.actionType)} from ${agentSeed.name}`}
                                    className="group relative flex flex-col items-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e18131]/50 rounded-xl min-w-[70px]"
                                  >
                                    <div className={cn(
                                      'relative w-12 h-12 flex items-center justify-center transition-transform duration-200',
                                      isSelected ? 'scale-110' : 'opacity-65 hover:opacity-100 hover:scale-105',
                                    )}>
                                      {isSelected ? (
                                        <span className="absolute inset-1 rounded-full bg-[radial-gradient(circle,rgba(225,129,49,0.35)_0%,rgba(225,129,49,0)_72%)] blur-[5px]" />
                                      ) : null}
                                      <img
                                        src={agentVisual.coloredSrc}
                                        alt={agentSeed.name}
                                        className={getHeadieAvatarClass(
                                          agentKey,
                                          cn('relative z-10 transition-all', isSelected ? 'w-10 h-10' : 'w-9 h-9'),
                                        )}
                                      />
                                    </div>

                                    <Badge className={cn(
                                      'mt-1 text-[9px] px-1.5 py-0 uppercase tracking-wide shadow-none border',
                                      urgency.className,
                                      !isSelected && 'opacity-75 group-hover:opacity-100',
                                    )}>
                                      {urgency.label}
                                    </Badge>

                                    {isSelected && (
                                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center text-[#94a3b8]">
                                        <div className="h-2 w-px bg-[#e18131]" />
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>

                            <Dialog open={!!selectedApproval} onOpenChange={(open) => !open && setSelectedApprovalId(null)}>
                              <DialogContent className="sm:max-w-[425px] rounded-[24px] overflow-hidden p-6 gap-0 bg-white border border-[#dbe4ef] shadow-[0_10px_40px_rgba(15,23,42,0.12)]">
                                <VisuallyHidden>
                                  <DialogTitle>Approval Details</DialogTitle>
                                </VisuallyHidden>
                                {selectedApproval ? (
                                  (() => {
                                    const candidate = parseApprovalCandidate(selectedApproval.payloadJson);
                                    const selectedAgentKey = resolveApprovalAgentKey(selectedApproval, candidate);
                                    const selectedAgentSeed = findHeadieSeed(selectedAgentKey);
                                    const selectedAgentVisual = HEADIE_AGENT_VISUALS[selectedAgentKey];
                                    
                                    // Safe urgency check for hydration
                                    const selectedUrgency = hasMounted 
                                      ? resolveApprovalUrgency(selectedApproval.expiresAtMs)
                                      : { label: 'Pending', className: 'bg-[#ecfeff] text-[#0e7490] border border-[#a5f3fc] shadow-none text-[10px] uppercase' };

                                    return (
                                      <div>
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="text-[11px] uppercase tracking-wider font-heading text-[#94a3b8]">Selected approval</div>
                                          <Badge className={selectedUrgency.className}>{selectedUrgency.label}</Badge>
                                        </div>

                                        <div className="flex items-center gap-2 mb-3">
                                          <div className="w-10 h-10 flex items-center justify-center">
                                            <img
                                              src={selectedAgentVisual.coloredSrc}
                                              alt={selectedAgentSeed.name}
                                              className={getHeadieAvatarClass(selectedAgentKey, 'w-7 h-7')}
                                            />
                                          </div>
                                          <div>
                                            <div className="text-[13px] font-semibold text-[#1e293b]">{selectedAgentSeed.name}</div>
                                            <div className="text-[11px] text-[#64748b]">{selectedAgentSeed.role}</div>
                                          </div>
                                        </div>

                                        <div className="text-[17px] font-heading font-medium text-[#1e293b] leading-tight mb-2">
                                          {toActionLabel(candidate.actionType ?? selectedApproval.actionType)}
                                        </div>
                                        <div className="text-[13px] text-[#64748b] font-sans mb-3">
                                          {selectedApproval.message ?? 'No binding message available.'}
                                        </div>

                                        <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3 text-[12px] font-sans text-[#475569] space-y-2 mb-4">
                                          <div className="flex items-center justify-between">
                                            <span>Candidate</span>
                                            <span className="font-medium text-[#334155]">{candidate.candidateName ?? candidate.clientName ?? 'Unknown'}</span>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <span>Role</span>
                                            <span className="font-medium text-[#334155]">{candidate.jobTitle ?? candidate.invoiceNumber ?? selectedApproval.resourceId ?? 'Unknown'}</span>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <span>Stage</span>
                                            <span className="font-medium text-[#334155]">{formatApprovalSummaryMeta(candidate)}</span>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <span>Expires</span>
                                            <span suppressHydrationWarning className="font-medium text-[#334155]">{formatExpiry(selectedApproval.expiresAtMs)}</span>
                                          </div>
                                        </div>

                                        <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] p-3 text-[12px] font-sans text-[#713f12] mb-4 space-y-2">
                                          <div className="font-medium text-[#92400e]">Approval authority: Auth0 CIBA</div>
                                          <div>
                                            Complete approve or deny in Auth0 Guardian push. Dashboard actions remain intentionally view-only for policy enforcement.
                                          </div>
                                          {selectedApproval.authReqId ? (
                                            <div className="text-[11px] font-mono text-[#a16207] break-all">
                                              auth_req_id: {selectedApproval.authReqId}
                                            </div>
                                          ) : null}
                                        </div>

                                        <Button
                                          variant="outline"
                                          onClick={() => showToast('Waiting for Auth0 callback | Pull-to-refresh is automatic via Convex reactivity')}
                                          className="w-full rounded-full border-[#cbd5e1] text-[#334155] hover:bg-[#f8fafc]"
                                        >
                                          Awaiting Auth0 Decision
                                        </Button>
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <div className="text-[13px] font-sans text-[#94a3b8]">Select an approval request to review details.</div>
                                )}
                              </DialogContent>
                            </Dialog>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="w-full h-full flex flex-col min-h-0">
                    <Card className="rounded-[24px] border border-[#dbe4ef] bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)] h-full flex flex-col">
                      <div className="px-5 py-3 border-b border-[#e2e8f0] bg-[linear-gradient(125deg,#f8fafc_0%,#fff7ed_55%,#f8fafc_100%)] shrink-0 rounded-t-[24px]">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[12px] text-[#94a3b8] uppercase tracking-wider font-heading">Agents active</div>
                            <div className="text-[14px] font-medium text-[#334155] mt-0.5">{activeAgentCount} live operators coordinating hiring loops</div>
                          </div>
                          <Button
                            variant="link"
                            onClick={() => setActiveScreen('agents')}
                            className="text-[13px] font-sans font-medium text-[#64748b] hover:text-[#e18131] h-auto p-0 transition-colors"
                          >
                            View logs
                          </Button>
                        </div>
                      </div>

                      <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                        {/* Detail View */}
                        <div className="flex-1 px-5 pt-4 pb-3 flex flex-col justify-center">
                          {(() => {
                            // Priority: cardDisplayAgentId -> first agent in roster
                            const displayId = cardDisplayAgentId || agentRoster[0]?._id;
                            const selectedAgent = agentRoster.find(ag => ag._id === displayId) || agentRoster[0];
                            
                            if (!selectedAgent) return null;
                            const isLive = selectedAgent.status === 'active';

                            return (
                              <div className={cn(
                                "transition-all duration-300",
                                isAgentSwitching ? "animate-blur-fade-out" : "animate-blur-fade-in"
                              )}>
                                <div className="text-[10px] font-semibold tracking-wider uppercase text-[#94a3b8] mb-1.5 font-heading">Current Activity</div>
                                <div className="text-[13px] leading-relaxed text-[#334155] font-medium">
                                  {selectedAgent.action || "Awaiting task execution."}
                                </div>
                                <div className="flex items-center justify-between mt-3">
                                  <div className="text-[11px] font-sans text-[#94a3b8] flex items-center gap-1.5">
                                    <Clock size={12} className="text-[#b4bfcc]" />
                                    {selectedAgent.last}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setTargetAgentKey(selectedAgent.key as HeadieAgentKey);
                                      setActiveScreen('agents');
                                    }}
                                    className="h-7 text-[11px] text-[#e18131] hover:text-[#c76922] hover:bg-[#fffaf5] px-2 -mr-2 transition-colors font-semibold"
                                  >
                                    Open Console <ArrowRight size={12} className="ml-1" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Avatar Strip — inside the card */}
                        <div className="shrink-0 px-4 pt-[0.4rem] pb-3 border-t border-[#f1f5f9]">
                          <div className="flex items-center justify-center gap-3 flex-wrap">
                            {agentRoster.map((ag) => {
                              const visual = HEADIE_AGENT_VISUALS[ag.key];
                              const isLive = ag.status === 'active';
                              const isSelected = ag._id === (dashboardSelectedAgentId || agentRoster[0]?._id);

                              return (
                                <button
                                  key={ag._id}
                                  onClick={() => {
                                    setDashboardSelectedAgentId(ag._id);
                                    // Pause the automated carousel for 30 seconds on manual interaction
                                    setCarouselPausedUntil(Date.now() + 30000);
                                    
                                    // Manual Click: Trigger same staggered card transition (extra snappy)
                                    setTimeout(() => {
                                      setIsAgentSwitching(true);
                                      setTimeout(() => {
                                        setCardDisplayAgentId(ag._id);
                                        setIsAgentSwitching(false);
                                      }, 150);
                                    }, 80); 
                                  }}
                                  className={cn(
                                    "relative transition-all outline-none rounded-full p-[3px]",
                                    isSelected ? "" : "hover:scale-105 opacity-55 hover:opacity-100 grayscale-[0.8] hover:grayscale-0"
                                  )}
                                >
                                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-200", isLive ? (isSelected ? "bg-[#fffaf5] border-[#e18131]" : "bg-white border-[#fed7aa]") : (isSelected ? "bg-[#f8fafc] border-[#94a3b8]" : "bg-[#f8fafc] border-[#e2e8f0]"))}>
                                    <img
                                      src={visual.coloredSrc}
                                      alt={ag.name}
                                      className={getHeadieAvatarClass(ag.key, 'w-6 h-6')}
                                    />
                                  </div>
                                  <span className="absolute bottom-0.5 right-0.5 flex h-3 w-3 rounded-full border-[2px] border-white shadow-sm overflow-hidden">
                                     <span className={cn("w-full h-full", isLive ? "bg-[#10b981]" : "bg-[#94a3b8]" )}></span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

              </div>
            )}
            
            {activeScreen === 'pipeline' && (
              <PipelineScreen />
            )}
            
            {activeScreen === 'jobs' && (
              <JobsScreen />
            )}

            {activeScreen === 'candidates' && (
              <CandidatesScreen />
            )}

            {activeScreen === 'workflows' && (
              <WorkflowsScreen initialQuery={automationQuery} />
            )}

            {activeScreen === 'approvals' && (
              <ApprovalsScreen />
            )}

            {activeScreen === 'audit' && (
              <AuditScreen />
            )}

            {activeScreen === 'team' && (
              <TeamScreen />
            )}

            {activeScreen === 'settings' && (
              <SettingsScreen />
            )}

            {activeScreen === 'agents' && (
              <AgentsScreen agents={agentRoster} initialSelectedKey={targetAgentKey ?? undefined} />
            )}

            {activeScreen !== 'dashboard' && activeScreen !== 'pipeline' && activeScreen !== 'jobs' && activeScreen !== 'candidates' && activeScreen !== 'workflows' && activeScreen !== 'approvals' && activeScreen !== 'audit' && activeScreen !== 'team' && activeScreen !== 'settings' && activeScreen !== 'agents' && (
              <div className="w-full h-full min-h-[400px] flex items-center justify-center flex-col text-[#94a3b8]">
                <div className="text-[48px] font-heading tracking-tight text-[#cbd5e1] capitalize mb-3">
                  {activeScreen} View
                </div>
                <p className="font-sans text-[#64748b] text-center max-w-sm">
                  This layout is perfectly restored to the HTML prototype structure while keeping the skeuomorphic Light Mode aesthetics.
                </p>
              </div>
            )}
            
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function JobsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  const filterOptions: FilterOption[] = [
    { id: 'team-design', label: 'Design', category: 'Team' },
    { id: 'team-platform', label: 'Platform', category: 'Team' },
    { id: 'team-product', label: 'Product', category: 'Team' },
    { id: 'team-eng', label: 'Engineering', category: 'Team' },
    { id: 'status-active', label: 'Active', category: 'Status' },
    { id: 'status-paused', label: 'Paused', category: 'Status' },
    { id: 'status-draft', label: 'Draft', category: 'Status' },
  ];

  const handleToggleFilter = (id: string) => {
    setActiveFilters(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const jobs = [
    {
      id: 'job_spd_001',
      slug: 'senior-product-designer',
      title: 'Senior Product Designer',
      team: 'Design',
      openedAt: 'Opened Mar 29',
      status: 'active',
      statusClass: 'bg-[#ecfdf5] text-[#15803d] border-[#bbf7d0]',
      applied: 42,
      reviewed: 24,
      interviewed: 8,
      manager: 'Radhika (Founder)',
    },
    {
      id: 'job_mle_002',
      slug: 'staff-ml-engineer',
      title: 'Staff ML Engineer',
      team: 'Platform',
      openedAt: 'Opened Mar 25',
      status: 'active',
      statusClass: 'bg-[#ecfdf5] text-[#15803d] border-[#bbf7d0]',
      applied: 31,
      reviewed: 17,
      interviewed: 4,
      manager: 'Chaitanya (Founder)',
    },
    {
      id: 'job_fpm_003',
      slug: 'founding-product-manager',
      title: 'Founding Product Manager',
      team: 'Product',
      openedAt: 'Opened Mar 18',
      status: 'paused',
      statusClass: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]',
      applied: 19,
      reviewed: 8,
      interviewed: 3,
      manager: 'Anya (Hiring Lead)',
    },
    {
      id: 'job_fe_004',
      slug: 'frontend-lead',
      title: 'Frontend Lead',
      team: 'Engineering',
      openedAt: 'Opened Apr 02',
      status: 'draft',
      statusClass: 'bg-[#f8fafc] text-[#475569] border-[#e2e8f0]',
      applied: 0,
      reviewed: 0,
      interviewed: 0,
      manager: 'Nora (Eng Lead)',
    },
  ];

  const jobCandidates = [
    { id: 'cand_001', name: 'Anya Sharma', stage: 'reviewed', score: 93, next: 'Portfolio deep-dive', jobSlug: 'senior-product-designer' },
    { id: 'cand_002', name: 'Marco Lin', stage: 'interview_scheduled', score: 89, next: 'System interview Tue 11:00', jobSlug: 'staff-ml-engineer' },
    { id: 'cand_003', name: 'Riya Patel', stage: 'interviewed', score: 91, next: 'Founder round summary', jobSlug: 'founding-product-manager' },
    { id: 'cand_004', name: 'Ibrahim Noor', stage: 'offer_sent', score: 87, next: 'Clearance pending', jobSlug: 'frontend-lead' },
  ];

  const isCreatePage = pathname === '/jobs/new';
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
  const jobCandidatesMatch = pathname.match(/^\/jobs\/([^/]+)\/candidates$/);
  const currentJobSlug = jobCandidatesMatch?.[1] ?? jobMatch?.[1] ?? null;
  const currentJob = jobs.find((job) => job.slug === currentJobSlug);

  if (isCreatePage) {
    return (
      <div className="flex flex-col gap-6 max-w-[980px] w-full mx-auto pb-10">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4">
          <div>
            <div className="text-[20px] font-heading font-medium text-[#1e293b]">Create Job</div>
            <div className="text-[13px] font-sans text-[#64748b]">Choose a start path. You can edit all fields before publishing.</div>
          </div>
          <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push('/jobs')}>
            Back to Jobs
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'Upload Job Description', copy: 'Parse JD and prefill role fields with rubric suggestions.' },
            { title: 'Start Manually', copy: 'Create from scratch with explicit role requirements.' },
            { title: 'Generate with AI', copy: 'Draft responsibilities, score rubric, and interview loop from prompt.' },
          ].map((option) => (
            <Card key={option.title} className="rounded-[16px] border border-[#e2e8f0] hover:border-[#cbd5e1] shadow-sm hover:shadow-[0_6px_18px_rgba(0,0,0,0.05)] transition-all cursor-pointer">
              <CardContent className="p-5">
                <div className="text-[14px] font-sans font-semibold text-[#1e293b]">{option.title}</div>
                <div className="text-[12px] font-sans text-[#64748b] mt-2 leading-relaxed">{option.copy}</div>
                <Button variant="outline" className="mt-4 h-8 rounded-full border-[#cbd5e1] text-[12px]">Choose</Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
          <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Role title</div>
              <Input placeholder="e.g. Senior Product Designer" className="h-10 border-[#cbd5e1]" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Hiring owner</div>
              <Input placeholder="e.g. Founder Hiring Pod" className="h-10 border-[#cbd5e1]" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Team</div>
              <Input placeholder="Design / Product / Engineering" className="h-10 border-[#cbd5e1]" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Level</div>
              <Input placeholder="Senior / Staff / Founding" className="h-10 border-[#cbd5e1]" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (jobCandidatesMatch && currentJob) {
    const rows = jobCandidates.filter((candidate) => candidate.jobSlug === currentJob.slug);
    return (
      <div className="flex flex-col gap-5 max-w-[980px] w-full mx-auto pb-10">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4">
          <div>
            <div className="text-[20px] font-heading font-medium text-[#1e293b]">{currentJob.title} Candidates</div>
            <div className="text-[13px] font-sans text-[#64748b]">Manage per-candidate transitions and interview follow-ups.</div>
          </div>
          <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push(`/jobs/${currentJob.slug}`)}>
            Back to Job
          </Button>
        </div>

        <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] text-[11px] uppercase tracking-wider font-heading text-[#64748b]">
            <div className="col-span-4">Candidate</div>
            <div className="col-span-2">Stage</div>
            <div className="col-span-2 text-right">Score</div>
            <div className="col-span-2">Next</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-[#f1f5f9] items-center hover:bg-[#fdfdfd]">
              <div className="col-span-4 text-[13px] font-sans font-medium text-[#1e293b]">{row.name}</div>
              <div className="col-span-2 text-[12px] font-sans text-[#64748b]">{row.stage.replace('_', ' ')}</div>
              <div className="col-span-2 text-right text-[13px] font-sans text-[#0f172a]">{row.score}</div>
              <div className="col-span-2 text-[12px] font-sans text-[#64748b] truncate">{row.next}</div>
              <div className="col-span-2 flex justify-end">
                <Button size="sm" variant="outline" className="h-7 rounded-full border-[#cbd5e1] text-[11px]" onClick={() => router.push(`/candidates/${row.id}`)}>
                  Open
                </Button>
              </div>
            </div>
          ))}
        </Card>
      </div>
    );
  }

  if (jobMatch && currentJob) {
    const recentCandidates = jobCandidates.filter((candidate) => candidate.jobSlug === currentJob.slug).slice(0, 3);
    return (
      <div className="flex flex-col gap-5 max-w-[980px] w-full mx-auto pb-10">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4">
          <div>
            <div className="text-[20px] font-heading font-medium text-[#1e293b]">{currentJob.title}</div>
            <div className="text-[13px] font-sans text-[#64748b]">{currentJob.team} · {currentJob.manager} · {currentJob.openedAt}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push(`/jobs/${currentJob.slug}/candidates`)}>
              Candidates
            </Button>
            <Button className="h-8 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[12px]">Open Pipeline</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading">Applied</div><div className="text-[26px] font-sans text-[#0f172a] mt-1">{currentJob.applied}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading">Reviewed</div><div className="text-[26px] font-sans text-[#0f172a] mt-1">{currentJob.reviewed}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading">Interviewed</div><div className="text-[26px] font-sans text-[#0f172a] mt-1">{currentJob.interviewed}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading">Status</div><Badge className={cn('mt-2 text-[10px] uppercase border shadow-none', currentJob.statusClass)}>{currentJob.status}</Badge></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm lg:col-span-2">
            <CardContent className="p-5">
              <div className="text-[13px] font-sans font-semibold text-[#1e293b] mb-3">Latest Candidates</div>
              <div className="space-y-2">
                {recentCandidates.map((candidate) => (
                  <div key={candidate.id} className="flex items-center justify-between rounded-[10px] border border-[#e2e8f0] px-3 py-2.5 hover:bg-[#f8fafc] cursor-pointer" onClick={() => router.push(`/candidates/${candidate.id}`)}>
                    <div>
                      <div className="text-[13px] font-sans font-medium text-[#1e293b]">{candidate.name}</div>
                      <div className="text-[11px] font-sans text-[#64748b]">{candidate.stage.replace('_', ' ')}</div>
                    </div>
                    <Badge className="text-[10px] bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] shadow-none">score {candidate.score}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
            <CardContent className="p-5">
              <div className="text-[13px] font-sans font-semibold text-[#1e293b] mb-3">Interview This Week</div>
              <div className="space-y-2 text-[12px] font-sans text-[#64748b]">
                <div className="rounded-[10px] border border-[#e2e8f0] p-2.5">Mon 3:30 PM · Marco Lin</div>
                <div className="rounded-[10px] border border-[#e2e8f0] p-2.5">Tue 11:00 AM · Riya Patel</div>
                <div className="rounded-[10px] border border-[#e2e8f0] p-2.5">Thu 2:00 PM · Ibrahim Noor</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-[1120px] w-full mx-auto pb-10">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div>
          <div className="text-[22px] font-heading font-medium text-[#1e293b]">Jobs</div>
          <div className="text-[13px] font-sans text-[#64748b]">Manage open requisitions, hiring owners, and stage velocity.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push('/pipeline')}>Open Pipeline</Button>
          <Button className="h-8 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[12px]" onClick={() => router.push('/jobs/new')}>
            <Plus size={13} className="mr-1.5" /> New Job
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Active Roles</div><div className="text-[34px] text-[#0f172a] font-sans mt-2">8</div><div className="text-[11px] text-[#16a34a]">2 opened this week</div></CardContent></Card>
        <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Candidates in Process</div><div className="text-[34px] text-[#0f172a] font-sans mt-2">137</div><div className="text-[11px] text-[#64748b]">Across all open jobs</div></CardContent></Card>
        <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Interviews This Week</div><div className="text-[34px] text-[#0f172a] font-sans mt-2">26</div><div className="text-[11px] text-[#d97706]">7 awaiting confirmation</div></CardContent></Card>
        <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Offers Awaiting Clearance</div><div className="text-[34px] text-[#0f172a] font-sans mt-2">3</div><div className="text-[11px] text-[#d97706]">1 expires in 21m</div></CardContent></Card>
        <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Time to First Interview</div><div className="text-[34px] text-[#0f172a] font-sans mt-2">3.4d</div><div className="text-[11px] text-[#16a34a]">-0.6d vs last sprint</div></CardContent></Card>
      </div>

      <Card className="rounded-[18px] border border-[#e2e8f0] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e2e8f0] bg-[#fbfcfe]">
          <div>
            <div className="text-[16px] font-heading text-[#1e293b]">Open Requisitions</div>
            <div className="text-[12px] font-sans text-[#64748b]">Filter by role status, hiring owner, and stage velocity.</div>
          </div>
          <UnifiedFilter 
            options={filterOptions}
            selected={activeFilters}
            onToggle={handleToggleFilter}
            onClear={() => setActiveFilters([])}
          />
        </div>
        <div className="p-3 space-y-2">
          {jobs.filter(job => {
            if (activeFilters.length === 0) return true;

            const teamFilters = activeFilters.filter(f => f.startsWith('team-'));
            const matchesTeam = teamFilters.length === 0 || teamFilters.some(f => {
              if (f === 'team-design') return job.team === 'Design';
              if (f === 'team-platform') return job.team === 'Platform';
              if (f === 'team-product') return job.team === 'Product';
              if (f === 'team-eng') return job.team === 'Engineering';
              return false;
            });

            const statusFilters = activeFilters.filter(f => f.startsWith('status-'));
            const matchesStatus = statusFilters.length === 0 || statusFilters.some(f => {
              if (f === 'status-active') return job.status === 'active';
              if (f === 'status-paused') return job.status === 'paused';
              if (f === 'status-draft') return job.status === 'draft';
              return false;
            });

            return matchesTeam && matchesStatus;
          }).map((job) => (
            <div key={job.id} className="rounded-[12px] border border-[#e2e8f0] px-4 py-3 hover:bg-[#fdfdfd] transition-colors">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-[20px] font-heading text-[#1e293b]">{job.title}</div>
                  <div className="text-[13px] font-sans text-[#64748b]">{job.team} · {job.openedAt}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-[10px] uppercase border shadow-none', job.statusClass)}>{job.status}</Badge>
                  <Button size="sm" variant="outline" className="h-7 rounded-full border-[#cbd5e1] text-[11px]" onClick={() => router.push(`/jobs/${job.slug}/candidates`)}>Candidates</Button>
                  <Button size="sm" variant="outline" className="h-7 rounded-full border-[#cbd5e1] text-[11px]" onClick={() => router.push(`/jobs/${job.slug}`)}>Open</Button>
                </div>
              </div>
              <div className="text-[12px] font-sans text-[#64748b] mt-2">
                {job.applied} applied · {job.reviewed} reviewed · {job.interviewed} interviewed
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-sans font-semibold text-[#1e293b]">Role Coverage Health</div>
            <div className="text-[12px] font-sans text-[#64748b]">Use this week to clear reviewed backlog and convert interviews to offers.</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="text-[10px] border bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] shadow-none">reviewed</Badge>
            <Badge className="text-[10px] border bg-[#fffbeb] text-[#b45309] border-[#fde68a] shadow-none">interview_scheduled</Badge>
            <Badge className="text-[10px] border bg-[#fff7ed] text-[#c2410c] border-[#fed7aa] shadow-none">offer_sent</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CandidatesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const filterOptions: FilterOption[] = [
    { id: 'role-design', label: 'Product Designer', category: 'Role' },
    { id: 'role-ml', label: 'ML Engineer', category: 'Role' },
    { id: 'role-pm', label: 'Product Manager', category: 'Role' },
    { id: 'role-frontend', label: 'Frontend Lead', category: 'Role' },
    { id: 'stage-reviewed', label: 'Reviewed', category: 'Stage' },
    { id: 'stage-scheduled', label: 'Interview Scheduled', category: 'Stage' },
    { id: 'stage-interviewed', label: 'Interviewed', category: 'Stage' },
    { id: 'stage-offer', label: 'Offer Sent', category: 'Stage' },
    { id: 'score-90', label: 'Score 90+', category: 'Performance' },
    { id: 'score-80', label: 'Score 80+', category: 'Performance' },
    { id: 'owner-triage', label: 'Triage', category: 'Owner' },
    { id: 'owner-liaison', label: 'Liaison', category: 'Owner' },
    { id: 'owner-analyst', label: 'Analyst', category: 'Owner' },
    { id: 'owner-dispatch', label: 'Dispatch', category: 'Owner' },
  ];

  const handleToggleFilter = (id: string) => {
    setActiveFilters(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const candidates = [
    {
      id: 'cand_001',
      name: 'Anya Sharma',
      role: 'Senior Product Designer',
      jobId: 'senior-product-designer',
      stage: 'reviewed',
      score: 93,
      confidence: [1, 1, 1, 1, 1, 1, 0, 1, 1, 1],
      source: 'gmail_thread_001',
      owner: 'Triage',
      latency: '42m',
    },
    {
      id: 'cand_002',
      name: 'Marco Lin',
      role: 'Staff ML Engineer',
      jobId: 'staff-ml-engineer',
      stage: 'interview_scheduled',
      score: 89,
      confidence: [1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
      source: 'slack_dm_402',
      owner: 'Liaison',
      latency: '18m',
    },
    {
      id: 'cand_003',
      name: 'Riya Patel',
      role: 'Founding Product Manager',
      jobId: 'founding-product-manager',
      stage: 'interviewed',
      score: 91,
      confidence: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      source: 'referral_email_22',
      owner: 'Analyst',
      latency: '1h 5m',
    },
    {
      id: 'cand_004',
      name: 'Ibrahim Noor',
      role: 'Frontend Lead',
      jobId: 'frontend-lead',
      stage: 'offer_sent',
      score: 87,
      confidence: [1, 1, 0, 1, 1, 0, 1, 1, 0, 1],
      source: 'gmail_thread_889',
      owner: 'Dispatch',
      latency: '14m',
    },
  ];

  const candidateMatch = pathname.match(/^\/candidates\/([^/]+)$/);
  const selectedCandidate = candidates.find((candidate) => candidate.id === candidateMatch?.[1]);

  if (selectedCandidate) {
    return (
      <div className="flex flex-col gap-5 max-w-[1020px] w-full mx-auto pb-10">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4">
          <div>
            <div className="text-[20px] font-heading font-medium text-[#1e293b]">{selectedCandidate.name}</div>
            <div className="text-[13px] font-sans text-[#64748b]">{selectedCandidate.role} · stage {selectedCandidate.stage.replace('_', ' ')}</div>
          </div>
          <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push('/candidates')}>
            Back to Candidates
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge className="text-[10px] bg-[#f8fafc] border border-[#e2e8f0] text-[#475569] shadow-none">identity: {selectedCandidate.source}</Badge>
          <Badge className="text-[10px] bg-[#f8fafc] border border-[#e2e8f0] text-[#475569] shadow-none">job: {selectedCandidate.jobId}</Badge>
          <Badge className="text-[10px] bg-[#f8fafc] border border-[#e2e8f0] text-[#475569] shadow-none">owner: {selectedCandidate.owner}</Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Score</div><div className="text-[30px] font-sans mt-1 text-[#0f172a]">{selectedCandidate.score}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Confidence</div><div className="text-[30px] font-sans mt-1 text-[#0f172a]">86%</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Rounds Completed</div><div className="text-[30px] font-sans mt-1 text-[#0f172a]">2</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Response Latency</div><div className="text-[30px] font-sans mt-1 text-[#0f172a]">{selectedCandidate.latency}</div></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm lg:col-span-2">
            <CardContent className="p-5">
              <div className="text-[14px] font-sans font-semibold text-[#1e293b] mb-3">Intel Summary</div>
              <div className="text-[13px] font-sans text-[#475569] leading-relaxed mb-3">
                Strong systems thinker with high-end collaboration signal. Candidate has consistent product intuition and clear ownership examples from prior roles.
              </div>
              <div className="space-y-2 text-[12px] font-sans text-[#64748b]">
                <div className="rounded-[10px] border border-[#e2e8f0] p-2.5">Qualification checks: 8/9 passed</div>
                <div className="rounded-[10px] border border-[#e2e8f0] p-2.5">Work history signal: strong trajectory in zero-to-one teams</div>
                <div className="rounded-[10px] border border-[#e2e8f0] p-2.5">Founder private note: align on ownership scope before final round</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
            <CardContent className="p-5">
              <div className="text-[14px] font-sans font-semibold text-[#1e293b] mb-3">Action Rail</div>
              <div className="flex flex-col gap-2">
                <Button className="h-8 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[12px]">Schedule</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Propose Slots</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Run Transcript Digest</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Draft Offer</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#fecaca] text-[#b91c1c] text-[12px] hover:bg-[#fef2f2]">Reject</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
          <CardContent className="p-5">
            <div className="text-[14px] font-sans font-semibold text-[#1e293b] mb-3">Interview Timeline</div>
            <div className="space-y-3">
              {[
                'Apr 02 · Intro call completed · summary attached',
                'Apr 03 · Portfolio review completed · pass',
                'Apr 06 · Founder round scheduled · awaiting candidate confirmation',
              ].map((event) => (
                <div key={event} className="rounded-[10px] border border-[#e2e8f0] px-3 py-2 text-[12px] font-sans text-[#64748b]">
                  {event}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-[1020px] w-full mx-auto pb-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-[22px] font-heading font-medium text-[#1e293b]">Candidates</div>
          <div className="text-[13px] font-sans text-[#64748b]">Cross-job candidate view with confidence strips and quick actions.</div>
        </div>
        <div className="flex items-center gap-3">
          <UnifiedFilter 
            options={filterOptions}
            selected={activeFilters}
            onToggle={handleToggleFilter}
            onClear={() => setActiveFilters([])}
          />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" size={16} />
            <Input 
              placeholder="Search by name, role, source..." 
              className="pl-9 h-9 w-[260px] border-[#cbd5e1] rounded-full" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] text-[11px] uppercase tracking-wider font-heading text-[#64748b]">
          <div className="col-span-3">Candidate</div>
          <div className="col-span-2">Role</div>
          <div className="col-span-2">Confidence</div>
          <div className="col-span-1 text-left">Score</div>
          <div className="col-span-2">Stage</div>
          <div className="col-span-2 text-left">Owner</div>
        </div>
        {candidates.filter(candidate => {
          // Search query check
          if (searchQuery && !candidate.name.toLowerCase().includes(searchQuery.toLowerCase()) && 
              !candidate.role.toLowerCase().includes(searchQuery.toLowerCase()) && 
              !candidate.source.toLowerCase().includes(searchQuery.toLowerCase())) {
            return false;
          }

          if (activeFilters.length === 0) return true;

          const roleFilters = activeFilters.filter(f => f.startsWith('role-'));
          const matchesRole = roleFilters.length === 0 || roleFilters.some(f => {
            if (f === 'role-design') return candidate.role.includes('Designer');
            if (f === 'role-ml') return candidate.role.includes('ML');
            if (f === 'role-pm') return candidate.role.includes('PM');
            if (f === 'role-frontend') return candidate.role.includes('Frontend');
            return false;
          });

          const stageFilters = activeFilters.filter(f => f.startsWith('stage-'));
          const matchesStage = stageFilters.length === 0 || stageFilters.some(f => {
            if (f === 'stage-reviewed') return candidate.stage === 'reviewed';
            if (f === 'stage-scheduled') return candidate.stage === 'interview_scheduled';
            if (f === 'stage-interviewed') return candidate.stage === 'interviewed';
            if (f === 'stage-offer') return candidate.stage === 'offer_sent';
            return false;
          });

          const scoreFilters = activeFilters.filter(f => f.startsWith('score-'));
          const matchesScore = scoreFilters.length === 0 || (activeFilters.includes('score-90') && candidate.score >= 90) || (activeFilters.includes('score-80') && candidate.score >= 80);

          const ownerFilters = activeFilters.filter(f => f.startsWith('owner-'));
          const matchesOwner = ownerFilters.length === 0 || ownerFilters.some(f => {
            if (f === 'owner-triage') return candidate.owner === 'Triage';
            if (f === 'owner-liaison') return candidate.owner === 'Liaison';
            if (f === 'owner-analyst') return candidate.owner === 'Analyst';
            if (f === 'owner-dispatch') return candidate.owner === 'Dispatch';
            return false;
          });

          return matchesRole && matchesStage && matchesScore && matchesOwner;
        }).map((candidate) => (
          <div
            key={candidate.id}
            onClick={() => router.push(`/candidates/${candidate.id}`)}
            className="group grid grid-cols-12 gap-3 px-5 py-3 border-b border-[#f1f5f9] items-center hover:bg-[#fdfdfd] cursor-pointer"
          >
            <div className="col-span-3 min-w-0">
              <div className="text-[13px] font-sans font-medium text-[#1e293b] truncate">{candidate.name}</div>
              <div className="text-[11px] font-sans text-[#94a3b8] truncate">{candidate.source}</div>
            </div>
            <div className="col-span-2 text-[12px] text-[#64748b] truncate">{candidate.role}</div>
            <div className="col-span-2 flex items-center pr-4">
              <div className="h-2 w-full bg-[#f1f5f9] rounded-full overflow-hidden border border-[#e2e8f0]">
                <div 
                   className="h-full bg-[#22c55e] transition-all" 
                   style={{ width: `${Math.round((candidate.confidence.filter(Boolean).length / candidate.confidence.length) * 100)}%` }} 
                />
              </div>
            </div>
            <div className="col-span-1 text-left text-[13px] text-[#0f172a] font-medium">{candidate.score}</div>
            <div className="col-span-2 text-[12px] text-[#64748b] capitalize">{candidate.stage.replace('_', ' ')}</div>
            <div className="col-span-2 flex items-center justify-start gap-2">
              <span className="flex items-center gap-1.5 text-[12px] text-[#64748b]">
                {(() => {
                  const agentKey = resolveHeadieAgentKey(candidate.owner);
                  const agentVisual = HEADIE_AGENT_VISUALS[agentKey];
                  return (
                    <img 
                      src={agentVisual.coloredSrc} 
                      alt={candidate.owner} 
                      className={getHeadieAvatarClass(agentKey, 'w-4 h-4')} 
                    />
                  );
                })()}
                {candidate.owner}
              </span>
              <ArrowRight size={15} className="text-[#94a3b8] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function ApprovalsScreen() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'denied'>('pending');
  const [selectedId, setSelectedId] = useState('appr_001');

  const approvals = [
    {
      id: 'appr_001',
      action: 'send_offer',
      status: 'pending',
      candidateName: 'Ibrahim Noor',
      jobTitle: 'Frontend Lead',
      comp: '$230k + 0.25%',
      requestedAt: '9m ago',
      expires: '21m remaining',
      authReqId: 'authreq_7a21f8',
    },
    {
      id: 'appr_002',
      action: 'send_offer',
      status: 'pending',
      candidateName: 'Riya Patel',
      jobTitle: 'Founding Product Manager',
      comp: '$210k + 0.2%',
      requestedAt: '23m ago',
      expires: '12m remaining',
      authReqId: 'authreq_70ff31',
    },
    {
      id: 'appr_003',
      action: 'reject_candidate',
      status: 'approved',
      candidateName: 'Noah Kline',
      jobTitle: 'Staff ML Engineer',
      comp: 'n/a',
      requestedAt: '2h ago',
      expires: 'resolved',
      authReqId: 'authreq_182eb5',
    },
    {
      id: 'appr_004',
      action: 'send_offer',
      status: 'denied',
      candidateName: 'Dina Rao',
      jobTitle: 'Senior Product Designer',
      comp: '$198k + 0.15%',
      requestedAt: '4h ago',
      expires: 'resolved',
      authReqId: 'authreq_8b2c18',
    },
  ];

  const filtered = approvals.filter((approval) => approval.status === tab);
  const selected = filtered.find((approval) => approval.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="flex flex-col gap-5 max-w-[1080px] w-full mx-auto pb-10">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[22px] font-heading font-medium text-[#1e293b]">Approvals</div>
          <div className="text-[13px] font-sans text-[#64748b]">Clearance queue with Auth0 CIBA authority.</div>
        </div>
        <div className="flex bg-[#f1f5f9] p-1 rounded-lg border border-[#e2e8f0]">
          {(['pending', 'approved', 'denied'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setTab(status)}
              className={cn('px-3 py-1.5 text-[12px] font-sans font-medium rounded-md border transition-colors capitalize', tab === status ? 'bg-white border-[#e2e8f0] text-[#0f172a]' : 'bg-transparent border-transparent text-[#64748b]')}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-3">
          {filtered.map((approval) => (
            <Card
              key={approval.id}
              onClick={() => setSelectedId(approval.id)}
              className={cn('rounded-[16px] border shadow-sm cursor-pointer transition-all', selected?.id === approval.id ? 'border-[#0f172a]' : 'border-[#e2e8f0] hover:border-[#cbd5e1]')}
            >
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] font-sans font-semibold text-[#1e293b]">{approval.candidateName}</div>
                  <div className="text-[12px] font-sans text-[#64748b]">{approval.jobTitle} · {approval.action.replace('_', ' ')}</div>
                  <div className="text-[11px] text-[#94a3b8] mt-1">Requested {approval.requestedAt}</div>
                </div>
                <ArrowRight size={16} className="text-[#94a3b8]" />
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-6 text-[13px] text-[#64748b]">No items in this tab.</CardContent></Card>
          )}
        </div>

        <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm h-fit xl:sticky xl:top-4">
          <CardContent className="p-5">
            {selected ? (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Selected approval</div>
                <div className="text-[18px] font-heading text-[#1e293b]">{selected.candidateName}</div>
                <div className="text-[13px] text-[#64748b] mt-1">{selected.jobTitle}</div>

                <div className="rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] p-3 mt-4 text-[12px] text-[#475569] space-y-2">
                  <div className="flex items-center justify-between"><span>Action</span><span className="font-medium text-[#334155]">{selected.action.replace('_', ' ')}</span></div>
                  <div className="flex items-center justify-between"><span>Comp package</span><span className="font-medium text-[#334155]">{selected.comp}</span></div>
                  <div className="flex items-center justify-between"><span>Expires</span><span className="font-medium text-[#334155]">{selected.expires}</span></div>
                </div>

                <div className="rounded-[12px] border border-[#fde68a] bg-[#fffbeb] p-3 mt-4 text-[12px] text-[#713f12] space-y-2">
                  <div className="font-medium text-[#92400e]">Approval authority: Auth0 CIBA</div>
                  <div>Approve or deny in Auth0 Guardian push. Local approve/deny controls remain disabled by policy.</div>
                  <div className="font-mono text-[11px] text-[#a16207] break-all">auth_req_id: {selected.authReqId}</div>
                </div>

                <div className="grid grid-cols-1 gap-2 mt-4">
                  <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Poll Clearance Status</Button>
                  <Button variant="outline" disabled className="h-8 rounded-full border-[#e2e8f0] text-[12px] text-[#94a3b8]">Approve in Guardian</Button>
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-[#64748b]">Select an approval request to review details.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuditScreen() {
  const [filter, setFilter] = useState<'all' | 'success' | 'pending' | 'denied' | 'error'>('all');
  const events = [
    { id: 'ev_001', action: 'offer.send.requested', actor: 'dispatch_agent', resource: 'candidate:cand_004', status: 'pending', date: 'Apr 05 14:22' },
    { id: 'ev_002', action: 'interview.schedule.sent', actor: 'liaison_agent', resource: 'candidate:cand_002', status: 'success', date: 'Apr 05 13:41' },
    { id: 'ev_003', action: 'offer.send.denied', actor: 'founder', resource: 'candidate:cand_011', status: 'denied', date: 'Apr 05 12:10' },
    { id: 'ev_004', action: 'calendar.sync.failed', actor: 'dispatch_agent', resource: 'integration:google', status: 'error', date: 'Apr 05 11:58' },
  ] as const;

  const filteredEvents = filter === 'all' ? events : events.filter((event) => event.status === filter);

  const statusClass: Record<string, string> = {
    success: 'bg-[#ecfdf5] text-[#15803d] border-[#bbf7d0]',
    pending: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]',
    denied: 'bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]',
    error: 'bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]',
  };

  return (
    <div className="flex flex-col gap-5 max-w-[980px] w-full mx-auto pb-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-[22px] font-heading font-medium text-[#1e293b]">Audit Trail</div>
          <div className="text-[13px] font-sans text-[#64748b]">Trace human and agent actions across candidate and offer workflows.</div>
        </div>
        <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Export JSON</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'success', 'pending', 'denied', 'error'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={cn('px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider font-heading border transition-colors', filter === status ? 'bg-white border-[#cbd5e1] text-[#0f172a]' : 'bg-[#f8fafc] border-[#e2e8f0] text-[#64748b]')}
          >
            {status}
          </button>
        ))}
      </div>

      <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] text-[11px] uppercase tracking-wider font-heading text-[#64748b]">
          <div className="col-span-3">Action</div>
          <div className="col-span-2">Actor</div>
          <div className="col-span-3">Resource</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Date</div>
        </div>
        {filteredEvents.map((event) => (
          <div key={event.id} className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-[#f1f5f9] items-center hover:bg-[#fdfdfd]">
            <div className="col-span-3 text-[12px] font-mono text-[#334155]">{event.action}</div>
            <div className="col-span-2 text-[12px] text-[#64748b]">{event.actor}</div>
            <div className="col-span-3 text-[12px] text-[#64748b]">{event.resource}</div>
            <div className="col-span-2"><Badge className={cn('text-[10px] uppercase border shadow-none', statusClass[event.status])}>{event.status}</Badge></div>
            <div className="col-span-2 text-right text-[12px] text-[#94a3b8]">{event.date}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function TeamScreen() {
  const members = [
    { name: 'Chaitanya', role: 'founder', status: 'active' },
    { name: 'Radhika', role: 'hiring_manager', status: 'active' },
    { name: 'Nora', role: 'interviewer', status: 'active' },
  ];

  const invites = [
    { email: 'design-lead@headhunt.ai', role: 'interviewer', status: 'pending' },
    { email: 'recruiter@headhunt.ai', role: 'hiring_manager', status: 'sent' },
  ];

  return (
    <div className="flex flex-col gap-5 max-w-[900px] w-full mx-auto pb-10">
      <div>
        <div className="text-[22px] font-heading font-medium text-[#1e293b]">Team</div>
        <div className="text-[13px] font-sans text-[#64748b]">Manage members, roles, and pending invites.</div>
      </div>

      <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
        <CardContent className="p-5 space-y-3">
          <div className="text-[13px] font-sans font-semibold text-[#1e293b]">Members</div>
          {members.map((member) => (
            <div key={member.name} className="flex items-center justify-between rounded-[10px] border border-[#e2e8f0] px-3 py-2.5">
              <div>
                <div className="text-[13px] font-sans font-medium text-[#1e293b]">{member.name}</div>
                <div className="text-[11px] font-sans text-[#64748b]">{member.role}</div>
              </div>
              <Badge className="text-[10px] bg-[#ecfdf5] text-[#15803d] border border-[#bbf7d0] shadow-none">{member.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
        <CardContent className="p-5">
          <div className="text-[13px] font-sans font-semibold text-[#1e293b] mb-3">Invite Team Member</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="email@company.com" className="h-9 border-[#cbd5e1]" />
            <Input placeholder="Role (founder, hiring_manager...)" className="h-9 border-[#cbd5e1]" />
            <Button className="h-9 bg-[#e18131] hover:bg-[#c76922] text-white rounded-full text-[12px]">Send Invite</Button>
          </div>
          <div className="mt-4 space-y-2">
            {invites.map((invite) => (
              <div key={invite.email} className="flex items-center justify-between rounded-[10px] border border-[#e2e8f0] px-3 py-2 text-[12px]">
                <span className="text-[#334155]">{invite.email}</span>
                <span className="text-[#64748b]">{invite.role} · {invite.status}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsScreen() {
  return (
    <div className="flex flex-col gap-5 max-w-[900px] w-full mx-auto pb-10">
      <div>
        <div className="text-[22px] font-heading font-medium text-[#1e293b]">Settings</div>
        <div className="text-[13px] font-sans text-[#64748b]">Organization defaults, scheduling policy, and automation safety.</div>
      </div>

      <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Default timezone</div>
            <Input value="America/Los_Angeles" readOnly className="h-9 border-[#cbd5e1] bg-[#f8fafc]" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Interview duration</div>
            <Input value="30 minutes" readOnly className="h-9 border-[#cbd5e1] bg-[#f8fafc]" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Offer send mode</div>
            <Input value="draft by default" readOnly className="h-9 border-[#cbd5e1] bg-[#f8fafc]" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-heading mb-2">Audit retention</div>
            <Input value="365 days" readOnly className="h-9 border-[#cbd5e1] bg-[#f8fafc]" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
        <CardContent className="p-5 space-y-3">
          <div className="text-[13px] font-sans font-semibold text-[#1e293b]">Automation Safety</div>
          {[
            'Require founder clearance for all offer sends',
            'Disable automatic follow-up chaining for slash commands',
            'Keep side-effect actions in draft mode by default',
          ].map((rule) => (
            <div key={rule} className="flex items-center justify-between rounded-[10px] border border-[#e2e8f0] px-3 py-2.5">
              <div className="text-[12px] font-sans text-[#334155]">{rule}</div>
              <div className="w-10 h-6 rounded-full bg-[#10b981] p-1 shadow-inner">
                <div className="w-4 h-4 rounded-full bg-white ml-auto shadow-sm" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

