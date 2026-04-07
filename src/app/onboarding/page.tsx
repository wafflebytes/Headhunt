"use client";
import {
  Building02Icon,
  Tick02Icon,
  User03Icon,
  SparklesIcon,
  SecurityCheckIcon,
  FileUploadIcon
} from '@hugeicons/core-free-icons';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from "@/lib/utils";

const INTEGRATIONS = [
  { id: 'google', name: 'Google', sub: 'Email, Calendar, Drive', icon: <svg width="24" height="24" viewBox="0 0 48 48"><path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/><path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/><path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/><path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/></svg> },
  { id: 'cal', name: 'Cal.com', sub: 'Fast Scheduling', icon: <div className="w-7 h-7 rounded-[6px] bg-[#1a1a1a] flex items-center justify-center text-[#ffffff] font-sans font-bold text-[13px] tracking-tight border border-[rgba(255,255,255,0.05)] shadow-sm">Cal</div> },
  { id: 'slack', name: 'Slack', sub: 'Ops Board Alerts', icon: <svg width="24" height="24" viewBox="0 0 24 24"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.835a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.835a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.835zM17.688 8.835a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.313zM15.165 18.958a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.52h2.52zM15.165 17.687a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.164a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A"/></svg> },
];

const AGENT_STORIES = [
  { name: 'Triage Agent', src: '/assets/headie-iconpack-coloured/headie-triage-coloured.png', color: 'text-[#e18131]', quote: 'I securely process inbound flows in real-time. Connect your tools, and I will instantly sync profiles using encrypted, sandboxed access.' },
  { name: 'Analyst Agent', src: '/assets/headie-iconpack-coloured/headie-analyst-coloured.png', color: 'text-[#3b82f6]', quote: 'I analyze interview transcripts to extract hiring signals. Your sensitive team data never leaves our localized, zero-retention environment.' },
  { name: 'Liaison Agent', src: '/assets/headie-iconpack-coloured/headie-liason-coloured.png', color: 'text-[#10b981]', quote: 'I navigate dense schedules to automatically coordinate slots. I strictly request read-only permissions for your free/busy availability markers.' },
  { name: 'Dispatch Agent', src: '/assets/headie-iconpack-coloured/headie-dispatch-coloured.png', color: 'text-[#8b5cf6]', quote: 'I calculate compensation bands and generate finalized offer letters. All financial parameters are kept completely isolated and secure.' },
];

const JOB_TITLES = ['Software Engineer', 'Senior Software Engineer', 'Staff ML Engineer', 'Product Designer', 'Senior Product Designer', 'Product Manager', 'Founding Product Manager'];
const DEPTS = ['Engineering', 'Design', 'Product', 'Marketing', 'Sales', 'Operations'];

const STEP_CONTENT = [
  { title: "Define your workspace", desc: "Let's set up the operational foundation. Headhunt adapts its workflows based on your role in the hiring process." },
  { title: "Connect your tools", desc: "Authorize agents to read calendar availability, sync applicant data, and send updates via Slack." },
  { title: "Open a requisition", desc: "Let's set up your first active role. Drop a JD below to instantly extract the title and department." },
  { title: "Interview structure", desc: "Design the hiring loop for this role." },
  { title: "Close parameters", desc: "Final step. Set up the structural guardrails for extending offers to ensure financial safety." },
];

type IntegrationId = 'google' | 'cal' | 'slack';

type OnboardingStatusIntegration = {
  id: string;
  connected: boolean;
  missingScopes: string[];
  connectUrl: string;
};

type OnboardingStatusResponse = {
  allRequiredConnected: boolean;
  integrations: OnboardingStatusIntegration[];
  initialOfferTemplate?: {
    enabled?: boolean;
    seeded?: boolean;
    inserted?: boolean;
    updated?: boolean;
    templateName?: string | null;
    error?: string | null;
  };
  initialIntake?: {
    enabled?: boolean;
    inserted?: boolean;
    runId?: string | null;
    scheduledFor?: string | null;
  };
  initialIntakeKickoff?: {
    attempted?: boolean;
    ok?: boolean;
    status?: number | null;
    functionName?: string | null;
    message?: string | null;
  };
  message?: string;
};

type JdSynthesisTemplate = {
  title: string;
  department: string;
  employmentType: string;
  location: string;
  compensation: string;
  roleSummary: string;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  benefits: string[];
  hiringSignals: string[];
};

type JdSynthesisResponse = {
  status?: string;
  source?: 'upload' | 'draft';
  synthesis?: JdSynthesisTemplate;
  message?: string;
};

type DraftJdFormState = {
  companyStage: string;
  employmentType: string;
  locationPolicy: string;
  compensationRange: string;
  mustHaveRequirements: string;
  preferredRequirements: string;
  coreResponsibilities: string;
  niceToHave: string;
  benefits: string;
};

const ONBOARDING_STEP_STORAGE_KEY = 'hh_onboarding_step';
const ONBOARDING_PENDING_CONNECT_STORAGE_KEY = 'hh_onboarding_pending_connect';
const ONBOARDING_CAL_OPTIMISTIC_SYNC_STORAGE_KEY = 'hh_onboarding_cal_optimistic_sync';

const INITIAL_DRAFT_JD_FORM: DraftJdFormState = {
  companyStage: '',
  employmentType: 'Full-time',
  locationPolicy: '',
  compensationRange: '',
  mustHaveRequirements: '',
  preferredRequirements: '',
  coreResponsibilities: '',
  niceToHave: '',
  benefits: '',
};

const EMPTY_CONNECTED_STATE: Record<IntegrationId, boolean> = {
  google: false,
  cal: false,
  slack: false,
};

const isIntegrationId = (value: string): value is IntegrationId => {
  return value === 'google' || value === 'cal' || value === 'slack';
};

const getIntegrationName = (id: IntegrationId): string => {
  const integration = INTEGRATIONS.find((item) => item.id === id);
  return integration?.name ?? id;
};

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  
  // State for Step 1
  const [role, setRole] = useState<'founder' | 'hr' | 'manager' | null>(null);
  const [orgName, setOrgName] = useState('');

  // State for Step 2
  const [connected, setConnected] = useState<Record<IntegrationId, boolean>>(EMPTY_CONNECTED_STATE);
  const [connectUrls, setConnectUrls] = useState<Partial<Record<IntegrationId, string>>>({});
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [allRequiredConnected, setAllRequiredConnected] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [connectingIntegration, setConnectingIntegration] = useState<IntegrationId | null>(null);
  const [agentIdx, setAgentIdx] = useState(0);
  const connectPopupRef = useRef<Window | null>(null);
  const connectPopupPollTimerRef = useRef<number | null>(null);

  const isCalOptimisticallySynced = useCallback(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.sessionStorage.getItem(ONBOARDING_CAL_OPTIMISTIC_SYNC_STORAGE_KEY) === '1';
  }, []);

  const clearConnectPopupPolling = useCallback(() => {
    if (connectPopupPollTimerRef.current !== null) {
      window.clearInterval(connectPopupPollTimerRef.current);
      connectPopupPollTimerRef.current = null;
    }

    connectPopupRef.current = null;
  }, []);

  const applyIntegrationState = useCallback((integrations: OnboardingStatusIntegration[]) => {
    const nextConnected: Record<IntegrationId, boolean> = { ...EMPTY_CONNECTED_STATE };
    const nextConnectUrls: Partial<Record<IntegrationId, string>> = {};

    for (const integration of integrations) {
      if (!isIntegrationId(integration.id)) {
        continue;
      }

      nextConnected[integration.id] = Boolean(integration.connected);
      nextConnectUrls[integration.id] = integration.connectUrl;
    }

    if (isCalOptimisticallySynced()) {
      nextConnected.cal = true;
    }

    setConnected(nextConnected);
    setConnectUrls(nextConnectUrls);
  }, [isCalOptimisticallySynced]);

  const markCalOptimisticallySynced = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(ONBOARDING_CAL_OPTIMISTIC_SYNC_STORAGE_KEY, '1');
    setConnected((previous) => ({
      ...previous,
      cal: true,
    }));
  }, []);

  const refreshConnectionStatus = useCallback(async () => {
    setConnectionsLoading(true);

    try {
      const response = await fetch('/api/onboarding/status', { cache: 'no-store' });

      if (response.status === 401) {
        window.location.href = '/auth/login?prompt=login&max_age=0&returnTo=/onboarding';
        return;
      }

      const payload = (await response.json()) as OnboardingStatusResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to check integration authorization status.');
      }

      applyIntegrationState(Array.isArray(payload.integrations) ? payload.integrations : []);
      setAllRequiredConnected(Boolean(payload.allRequiredConnected));

      if (typeof window !== 'undefined') {
        const pendingConnect = window.sessionStorage.getItem(ONBOARDING_PENDING_CONNECT_STORAGE_KEY);
        if (pendingConnect && isIntegrationId(pendingConnect)) {
          const integrationState = (payload.integrations ?? []).find((integration) => integration.id === pendingConnect);
          if (integrationState?.connected) {
            toast.success(`${getIntegrationName(pendingConnect)} connected successfully.`);
            setStep(2);
          }

          window.sessionStorage.removeItem(ONBOARDING_PENDING_CONNECT_STORAGE_KEY);
        }
      }
    } catch (error) {
      setAllRequiredConnected(false);
      toast.error('Unable to verify connections right now. Please refresh and try again.');
    } finally {
      setConnectionsLoading(false);
    }
  }, [applyIntegrationState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const savedStep = Number(window.sessionStorage.getItem(ONBOARDING_STEP_STORAGE_KEY));
    if (Number.isInteger(savedStep) && savedStep >= 1 && savedStep <= 5) {
      setStep(savedStep);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(ONBOARDING_STEP_STORAGE_KEY, String(step));
  }, [step]);

  useEffect(() => {
    if (step === 2) {
      const timer = setInterval(() => {
        setAgentIdx(prev => (prev + 1) % AGENT_STORIES.length);
      }, 2500); // 2.5s to give them time to read
      return () => clearInterval(timer);
    }
  }, [step]);

  useEffect(() => {
    return () => {
      clearConnectPopupPolling();
    };
  }, [clearConnectPopupPolling]);

  useEffect(() => {
    void refreshConnectionStatus();
  }, [refreshConnectionStatus]);

  // State for Step 3
  const [jobTitle, setJobTitle] = useState('');
  const [jobDept, setJobDept] = useState('');
  const [showTitleOptions, setShowTitleOptions] = useState(false);
  const [showDeptOptions, setShowDeptOptions] = useState(false);
  const [showDraftBuilder, setShowDraftBuilder] = useState(false);
  const [isStep3ModalOpen, setIsStep3ModalOpen] = useState(false);
  const [draftForm, setDraftForm] = useState<DraftJdFormState>(INITIAL_DRAFT_JD_FORM);
  const [jdSynthesis, setJdSynthesis] = useState<JdSynthesisTemplate | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // D&D Parser State
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isParsed, setIsParsed] = useState(false);

  // State for Step 4
  const [rounds, setRounds] = useState(3);
  const [hiringChips, setHiringChips] = useState<string[]>([]);
  
  // State for Step 5
  const [gateAction, setGateAction] = useState<'Founder' | 'Hiring Manager' | 'Auto'>('Founder');
  const [compRange, setCompRange] = useState('');

  // Background Cursor Effect — ref-based to avoid React re-renders
  const gradientRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    const handleMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (gradientRef.current) {
          gradientRef.current.style.left = `${e.clientX}px`;
          gradientRef.current.style.top = `${e.clientY}px`;
        }
      });
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const finishOnboarding = async () => {
    if (isFinalizing) {
      return;
    }

    setIsFinalizing(true);

    try {
      const response = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          role,
          organizationName: orgName,
          jobTitle,
          jobDepartment: jobDept,
          jdSynthesis,
        }),
      });

      if (response.status === 401) {
        window.location.href = '/auth/login?prompt=login&max_age=0&returnTo=/onboarding';
        return;
      }

      const payload = (await response.json()) as OnboardingStatusResponse;

      if (!response.ok) {
        applyIntegrationState(Array.isArray(payload.integrations) ? payload.integrations : []);
        setAllRequiredConnected(Boolean(payload.allRequiredConnected));
        setStep(2);
        toast.error(payload.message ?? 'Please connect all required integrations before continuing.');
        return;
      }

      const templateSeedState = payload.initialOfferTemplate?.seeded
        ? payload.initialOfferTemplate.inserted
          ? 'seeded'
          : payload.initialOfferTemplate.updated
            ? 'updated'
            : 'ready'
        : payload.initialOfferTemplate?.enabled
          ? 'failed'
          : 'skipped';

      const intakeState = payload.initialIntake?.enabled
        ? payload.initialIntake.inserted
          ? 'queued'
          : 'already queued'
        : 'disabled';

      toast.success(`Onboarding complete. Offer template ${templateSeedState}; intake ${intakeState}. Entering dashboard...`);
      if (payload.initialOfferTemplate?.error) {
        toast.warning(`Offer template seed warning: ${payload.initialOfferTemplate.error}`);
      }
      if (payload.initialIntakeKickoff?.attempted && payload.initialIntakeKickoff.ok === false) {
        toast.warning(
          `Intake kickoff warning: ${
            payload.initialIntakeKickoff.message ?? 'v2 intercept trigger failed; cron processing may be delayed.'
          }`,
        );
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(ONBOARDING_STEP_STORAGE_KEY);
        window.sessionStorage.removeItem(ONBOARDING_PENDING_CONNECT_STORAGE_KEY);
        window.sessionStorage.removeItem(ONBOARDING_CAL_OPTIMISTIC_SYNC_STORAGE_KEY);
      }

      window.location.href = '/';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete onboarding.');
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleConnect = (id: IntegrationId) => {
    const connectUrl = connectUrls[id];

    if (!connectUrl) {
      toast.error('Unable to start authorization right now. Reload and try again.');
      return;
    }

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ONBOARDING_STEP_STORAGE_KEY, '2');
      window.sessionStorage.setItem(ONBOARDING_PENDING_CONNECT_STORAGE_KEY, id);

      let popupConnectUrl = connectUrl;
      try {
        const parsedUrl = new URL(connectUrl, window.location.origin);
        parsedUrl.searchParams.set('returnTo', '/close');
        popupConnectUrl = parsedUrl.toString();
      } catch {
        // Fall back to the API-provided URL below.
      }

      const popup = window.open(
        popupConnectUrl,
        '_blank',
        'width=800,height=650,status=no,toolbar=no,menubar=no',
      );

      if (!popup) {
        toast.error('Popup was blocked. Redirecting to complete authorization.');
        location.href = connectUrl;
        return;
      }

      clearConnectPopupPolling();
      connectPopupRef.current = popup;
      setConnectingIntegration(id);
      toast(`${getIntegrationName(id)} authorization opened in a popup.`);

      connectPopupPollTimerRef.current = window.setInterval(() => {
        const activePopup = connectPopupRef.current;
        if (!activePopup || activePopup.closed) {
          if (id === 'cal') {
            markCalOptimisticallySynced();
            toast.success('Cal.com connected and synced for demo mode.');
          }

          clearConnectPopupPolling();
          setConnectingIntegration(null);
          void refreshConnectionStatus();
        }
      }, 1000);
      return;
    }

    // This handler only runs in the browser; keep a safe no-op fallback for type narrowing.
    return;
  };

  const toggleChip = (chip: string) => {
    setHiringChips(prev => prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]);
  };

  const applySynthesizedTemplate = useCallback((template: JdSynthesisTemplate) => {
    setJdSynthesis(template);
    setIsParsed(true);
    setShowDraftBuilder(false);
    setIsStep3ModalOpen(true);
    setJobTitle((prev) => (prev.trim().length > 0 ? prev : template.title));
    setJobDept((prev) => (prev.trim().length > 0 ? prev : template.department));
    toast.success('synthesizing done!');
  }, []);

  const synthesizeFromUploadedPdf = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Please upload a PDF job description.');
      return;
    }

    setIsDragging(false);
    setShowDraftBuilder(false);
    setIsParsing(true);
    setIsParsed(false);
    setJdSynthesis(null);
    setUploadedFileName(file.name);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('jobTitle', jobTitle);
      formData.append('jobDepartment', jobDept);

      const response = await fetch('/api/onboarding/jd-synthesize', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json()) as JdSynthesisResponse;
      if (!response.ok || !payload.synthesis) {
        throw new Error(payload.message ?? 'Failed to synthesize job description.');
      }

      applySynthesizedTemplate(payload.synthesis);
    } catch (error) {
      setIsParsed(false);
      toast.error(error instanceof Error ? error.message : 'Failed to synthesize job description.');
    } finally {
      setIsParsing(false);
    }
  }, [applySynthesizedTemplate, jobDept, jobTitle]);

  const synthesizeDraftWithAi = useCallback(async () => {
    setIsStep3ModalOpen(true);
    setIsParsing(true);
    setIsParsed(false);
    setJdSynthesis(null);
    setUploadedFileName('AI generated draft');

    try {
      const response = await fetch('/api/onboarding/jd-synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'draft',
          jobTitle,
          jobDepartment: jobDept,
          ...draftForm,
        }),
      });

      const payload = (await response.json()) as JdSynthesisResponse;
      if (!response.ok || !payload.synthesis) {
        throw new Error(payload.message ?? 'Failed to generate draft job description.');
      }

      applySynthesizedTemplate(payload.synthesis);
    } catch (error) {
      setIsParsed(false);
      toast.error(error instanceof Error ? error.message : 'Failed to generate draft job description.');
    } finally {
      setIsParsing(false);
    }
  }, [applySynthesizedTemplate, draftForm, jobDept, jobTitle]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    void synthesizeFromUploadedPdf(file);
    event.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) {
      setIsDragging(false);
      return;
    }

    void synthesizeFromUploadedPdf(file);
  };

  const handleDraftFieldChange = (field: keyof DraftJdFormState, value: string) => {
    setDraftForm((prev) => ({ ...prev, [field]: value }));
  };

  const currentStepInfo = STEP_CONTENT[step - 1];

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-start pt-12 pb-8 px-6 overflow-hidden relative selection:bg-[#e18131]/20">
      
      {/* Dynamic Cursor Gradient */}
      <div 
        ref={gradientRef}
        className="absolute w-[1400px] h-[1400px] rounded-full pointer-events-none z-0"
        style={{
          background: 'radial-gradient(circle, rgba(225, 129, 49, 0.12) 0%, transparent 60%)',
          left: -1000,
          top: -1000,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(150px)',
          willChange: 'left, top',
          transition: 'left 80ms ease-out, top 80ms ease-out'
        }}
      />

      {/* Refined Background Elements */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-white to-transparent pointer-events-none" />
      <div className="absolute -top-[20%] -right-[10%] w-[600px] h-[600px] bg-[#e18131]/[0.03] blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-[20%] -left-[10%] w-[500px] h-[500px] bg-[#3b82f6]/[0.02] blur-[100px] rounded-full pointer-events-none" />

      <div className="absolute top-6 right-6 z-20">
        <a href="/logout">
          <Button
            variant="ghost"
            className="h-8 rounded-full px-3 text-[12px] text-[#64748b] border border-[#e2e8f0] bg-white/80 backdrop-blur-sm hover:text-[#0f172a] hover:bg-white"
          >
            Logout
          </Button>
        </a>
      </div>

      {/* Static Header */}
      <div className="w-full max-w-[700px] flex items-center justify-between z-10 animate-blur-fade-in mb-12">
        <div className="flex items-center gap-2.5">
          <img src="/assets/headie.png" alt="Headhunt Logo" className="w-[30px] h-[30px] object-contain drop-shadow-sm" />
          <span className="font-display font-semibold text-[24px] tracking-[-0.02em] text-[#304f67] leading-none mt-0.5">Headhunt</span>
        </div>
        <div className="flex gap-2">
          {[1,2,3,4,5].map(s => (
            <div key={s} className="flex items-center">
              <div className={cn(
                "w-2 h-2 rounded-full transition-all duration-500",
                step === s ? "bg-[#e18131] w-6" : step > s ? "bg-[#0f172a]" : "bg-[#e2e8f0]"
              )} />
            </div>
          ))}
        </div>
      </div>

      {/* Static Titles Container (UX Constriction) */}
      <div className="w-full max-w-[640px] z-10 relative mb-8">
        <h1 className="text-[42px] font-heading font-medium tracking-tight text-[#0f172a] leading-tight mb-4 transition-all duration-300">
          {currentStepInfo.title}
        </h1>
        <p className="text-[16px] text-[#64748b] font-sans leading-relaxed max-w-[85%] transition-all duration-300 min-h-[50px]">
          {currentStepInfo.desc}
        </p>
      </div>

      {/* Dynamic Content Area (Animates on step change) */}
      <div className="w-full max-w-[640px] z-10 relative flex-1 min-h-[400px]">
        <div key={step} className="animate-in fade-in slide-in-from-bottom-6 duration-700 ease-out fill-mode-both">
          
          {step === 1 && (
            <div className="flex flex-col animate-blur-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                <button 
                  onClick={() => setRole('founder')}
                  className={cn(
                    "flex flex-col items-start p-6 rounded-[24px] border transition-all duration-300 text-left relative overflow-hidden group",
                    role === 'founder' ? "border-[#0f172a] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.08)] ring-1 ring-[#0f172a]" : "border-[#e2e8f0] bg-white/60 hover:bg-white hover:border-[#cbd5e1]"
                  )}
                >
                  <HugeIcon icon={Building02Icon} size={24} className={role === 'founder' ? "text-[#0f172a]" : "text-[#94a3b8]"} />
                  <span className="font-heading font-medium text-[18px] text-[#0f172a] mt-4 mb-1">Founder / CEO</span>
                  <span className="font-sans text-[13px] text-[#64748b]">High-level oversight, final offer approvals, and strategic workflow generation.</span>
                  {role === 'founder' && <div className="absolute top-6 right-6 w-5 h-5 bg-[#0f172a] rounded-full flex items-center justify-center text-white"><HugeIcon icon={Tick02Icon} size={14} /></div>}
                </button>

                <button 
                  onClick={() => setRole('hr')}
                  className={cn(
                    "flex flex-col items-start p-6 rounded-[24px] border transition-all duration-300 text-left relative overflow-hidden group",
                    role === 'hr' ? "border-[#0f172a] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.08)] ring-1 ring-[#0f172a]" : "border-[#e2e8f0] bg-white/60 hover:bg-white hover:border-[#cbd5e1]"
                  )}
                >
                  <HugeIcon icon={User03Icon} size={24} className={role === 'hr' ? "text-[#0f172a]" : "text-[#94a3b8]"} />
                  <span className="font-heading font-medium text-[18px] text-[#0f172a] mt-4 mb-1">HR / Talent Lead</span>
                  <span className="font-sans text-[13px] text-[#64748b]">Pipeline management, intake tracking, and automated scheduling control.</span>
                  {role === 'hr' && <div className="absolute top-6 right-6 w-5 h-5 bg-[#0f172a] rounded-full flex items-center justify-center text-white"><HugeIcon icon={Tick02Icon} size={14} /></div>}
                </button>
              </div>

              <div className={cn("transition-all duration-500", role ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none")}>
                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">
                  Organization Name
                </label>
                <Input 
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Acme Labs"
                  className="h-[64px] rounded-[20px] bg-white border-[#e2e8f0] text-[18px] font-medium px-6 shadow-sm focus-visible:border-[#0f172a] focus-visible:ring-1 focus-visible:ring-[#0f172a] transition-all"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col">
              <div className="flex gap-8 mb-10">
                {/* Agent Guide Chat Bubbles */}
                <div className="w-[280px] shrink-0 hidden sm:flex flex-col relative min-h-[290px]">
                  
                  {/* Messages Area */}
                  <div className="flex-1 relative w-full h-full">
                    {AGENT_STORIES.map((agent, i) => (
                      <div 
                        key={agent.name}
                        className={cn(
                          "absolute top-0 left-0 w-full transition-all duration-500 ease-out flex flex-col items-start gap-3",
                          agentIdx === i ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
                        )}
                      >
                         {/* Avatar & Name */}
                         <div className="flex items-center gap-3 mb-1">
                           <img
                             src={agent.src}
                             className="w-10 h-10 object-contain drop-shadow-sm shrink-0"
                             alt={agent.name}
                             onError={(event) => {
                               event.currentTarget.onerror = null;
                               event.currentTarget.src = '/assets/headie.png';
                             }}
                           />
                           <span className={cn("text-[13px] font-bold uppercase tracking-wider", agent.color)}>{agent.name}</span>
                         </div>
                         
                         {/* Skeuomorphic Bubble */}
                         <div className="bg-gradient-to-b from-[#ffffff] to-[#f8fafc] border border-[#cbd5e1] shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_6px_16px_rgba(15,23,42,0.06)] p-6 rounded-[24px] rounded-tl-[12px] relative max-w-[280px] w-full ring-1 ring-black/[0.03]">
                           <div className="absolute -top-[8px] left-[26px] w-4 h-4 bg-[#ffffff] border-t border-l border-[#cbd5e1] shadow-[inset_1px_1px_1px_rgba(255,255,255,0.9)] rotate-45" />
                           <p className="text-[15px] text-[#334155] font-medium leading-relaxed relative z-10 drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
                             &ldquo;{agent.quote}&rdquo;
                           </p>
                         </div>
                      </div>
                    ))}
                  </div>

                  {/* Progress Line */}
                  <div className="absolute bottom-0 left-0 w-full flex gap-1.5 justify-center z-10 pb-2">
                    {AGENT_STORIES.map((_, i) => (
                       <div key={i} className={cn("h-1.5 rounded-full transition-all duration-300", agentIdx === i ? "bg-[#e18131] w-4" : "bg-[#cbd5e1] w-2.5")} />
                    ))}
                  </div>

                </div>

                {/* Integrations List */}
                <div className="flex-1 flex flex-col gap-3">
                  {INTEGRATIONS.map(item => {
                    const integrationId = item.id as IntegrationId;
                    const integrationConnected = connected[integrationId];

                    return (
                    <div key={item.id} className="bg-white rounded-[20px] border border-[#e2e8f0] p-4 flex items-center justify-between group hover:border-[#cbd5e1] hover:shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-[14px] bg-[#f8fafc] border border-[#f1f5f9] flex items-center justify-center">
                          {item.icon}
                        </div>
                        <div>
                          <div className="font-heading font-medium text-[15px] text-[#0f172a]">{item.name}</div>
                          <div className="text-[12px] text-[#64748b]">{item.sub}</div>
                        </div>
                      </div>
                      {integrationConnected ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#f0fdf4] text-[#10b981] text-[12px] font-medium border border-[#bbf7d0]">
                          <HugeIcon icon={Tick02Icon} size={14} /> Synced
                        </div>
                      ) : (
                        <Button 
                          variant="outline" 
                          disabled={connectionsLoading || connectingIntegration !== null}
                          onClick={() => handleConnect(integrationId)}
                          className="rounded-full h-8 text-[12px] px-4 border-[#e2e8f0] text-[#475569] hover:text-[#0f172a] hover:border-[#0f172a] transition-all"
                        >
                          {connectingIntegration === integrationId ? 'Connecting...' : 'Connect'}
                        </Button>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col">
              <div className="bg-white p-8 rounded-[28px] border border-[#e2e8f0] shadow-[0_4px_24px_rgba(0,0,0,0.02)] relative overflow-visible">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleFileInputChange}
                />

                <div className="space-y-6">
                  <div className="relative">
                    <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Job Title</label>
                    <Input
                      value={jobTitle}
                      onChange={(e) => {
                        setJobTitle(e.target.value);
                        setShowTitleOptions(true);
                      }}
                      onFocus={() => setShowTitleOptions(true)}
                      onBlur={() => setTimeout(() => setShowTitleOptions(false), 200)}
                      placeholder="e.g. Senior Product Designer"
                      className="h-[56px] rounded-[16px] text-[16px] border-[#e2e8f0] focus-visible:ring-[#0f172a]"
                    />
                    {showTitleOptions && jobTitle.length > 0 && !JOB_TITLES.includes(jobTitle) && (
                      <div className="absolute top-[82px] left-0 w-full bg-white border border-[#e2e8f0] rounded-[14px] shadow-lg overflow-hidden z-20">
                        {JOB_TITLES.filter((titleOption) =>
                          titleOption.toLowerCase().includes(jobTitle.toLowerCase()),
                        ).map((titleOption) => (
                          <div
                            key={titleOption}
                            className="px-4 py-3 text-[14px] hover:bg-[#f8fafc] cursor-pointer"
                            onClick={() => setJobTitle(titleOption)}
                          >
                            {titleOption}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Department</label>
                    <Input
                      value={jobDept}
                      onChange={(e) => {
                        setJobDept(e.target.value);
                        setShowDeptOptions(true);
                      }}
                      onFocus={() => setShowDeptOptions(true)}
                      onBlur={() => setTimeout(() => setShowDeptOptions(false), 200)}
                      placeholder="e.g. Platform Engineering"
                      className="h-[56px] rounded-[16px] text-[16px] border-[#e2e8f0] focus-visible:ring-[#0f172a]"
                    />
                    {showDeptOptions && (
                      <div className="absolute top-[82px] left-0 w-full bg-white border border-[#e2e8f0] rounded-[14px] shadow-lg overflow-hidden z-20">
                        {DEPTS.filter((departmentOption) =>
                          departmentOption.toLowerCase().includes(jobDept.toLowerCase()),
                        ).map((departmentOption) => (
                          <div
                            key={departmentOption}
                            className="px-4 py-3 text-[14px] hover:bg-[#f8fafc] cursor-pointer"
                            onClick={() => setJobDept(departmentOption)}
                          >
                            {departmentOption}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    className={cn(
                      "border-2 border-dashed rounded-[20px] transition-all duration-300 flex flex-col items-center justify-center text-center px-4 h-[140px] cursor-pointer",
                      isParsing
                        ? 'bg-[#fff7ed] border-[#fed7aa]'
                        : isParsed
                          ? 'bg-[#f0fdf4] border-[#bbf7d0]'
                          : isDragging
                            ? 'bg-[#f8fafc] border-[#0f172a]'
                            : 'border-[#e2e8f0] hover:border-[#cbd5e1] hover:bg-[#fcfdfe]',
                    )}
                    onClick={() => {
                      if (!isParsing) {
                        handleUploadClick();
                      }
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && !isParsing) {
                        event.preventDefault();
                        handleUploadClick();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!isParsing) {
                        setIsDragging(true);
                      }
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    role="button"
                    tabIndex={0}
                  >
                    {isParsing ? (
                      <div className="flex flex-col items-center gap-3">
                        <HugeIcon icon={SparklesIcon} size={28} className="text-[#e18131] animate-spin-slow" />
                        <div className="text-[14px] font-medium text-[#0f172a]">Headie is synthesizing your job description, please hold on...</div>
                      </div>
                    ) : isParsed ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-white border border-[#bbf7d0] text-[#10b981] flex items-center justify-center shadow-sm">
                          <HugeIcon icon={Tick02Icon} size={18} />
                        </div>
                        <div className="text-[14px] font-medium text-[#166534]">synthesizing done!</div>
                        {uploadedFileName && (
                          <div className="text-[12px] text-[#166534]/80">{uploadedFileName}</div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#94a3b8]">
                          <HugeIcon icon={FileUploadIcon} size={20} />
                        </div>
                        <div className="text-[14px] font-medium text-[#0f172a]">Drop or Upload job description.</div>
                        <div className="text-[12px] text-[#64748b]">PDF only, up to 10MB</div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 pt-2">
                    <div className="h-px bg-[#f1f5f9] flex-1"></div>
                    <div className="text-[12px] font-medium text-[#94a3b8]">OR</div>
                    <div className="h-px bg-[#f1f5f9] flex-1"></div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowDraftBuilder(true);
                        setIsStep3ModalOpen(true);
                      }}
                      disabled={isParsing}
                      className="gap-2 text-[#64748b] hover:text-[#0f172a] hover:bg-[#f8fafc] rounded-full h-9 px-4 text-[12px] border border-[#e2e8f0] transition-all w-full"
                    >
                      <HugeIcon icon={SparklesIcon} size={14} className="text-[#e18131]" />
                      Draft JD automatically with AI
                    </Button>

                    {jdSynthesis && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowDraftBuilder(false);
                          setIsStep3ModalOpen(true);
                        }}
                        disabled={isParsing}
                        className="rounded-full h-9 px-4 text-[12px] border border-[#e2e8f0]"
                      >
                        View synthesized JD
                      </Button>
                    )}
                  </div>

                  <Dialog open={isStep3ModalOpen} onOpenChange={setIsStep3ModalOpen}>
                    <DialogContent className="max-w-[880px] w-[95vw] max-h-[90vh] overflow-hidden rounded-[28px] border border-[#e2e8f0] bg-white p-0 shadow-[0_32px_80px_-12px_rgba(15,23,42,0.15)] [&>button]:right-6 [&>button]:top-6 [&>button]:h-9 [&>button]:w-9 [&>button]:rounded-full [&>button]:border [&>button]:border-[#e2e8f0] [&>button]:bg-[#f8fafc] [&>button]:text-[#64748b] [&>button]:opacity-100 [&>button]:hover:bg-white [&>button]:hover:text-[#0f172a] [&>button]:focus:ring-[#0f172a] [&>button]:transition-all">
                      <div className="px-8 py-6 border-b border-[#f1f5f9] bg-[#fafafa]/50 relative">
                        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none rounded-t-[28px]">
                          <div className="absolute top-[-50%] left-[-10%] w-[50%] h-[200%] bg-gradient-to-br from-[#e18131]/[0.03] to-transparent rotate-12" />
                        </div>
                        <DialogTitle className="text-[20px] font-heading font-semibold text-[#0f172a] leading-tight relative z-10 flex items-center gap-2">
                          {showDraftBuilder ? 'Draft Job Description with AI' : 'Traditional JD Template'}
                          {!showDraftBuilder && jdSynthesis && (
                            <span className="px-2.5 py-0.5 rounded-full bg-[#f0fdf4] border border-[#bbf7d0] text-[#10b981] text-[11px] font-sans font-medium tracking-wide shadow-sm translate-y-px">
                              <HugeIcon icon={Tick02Icon} size={12} className="inline mr-1" />
                              Ready
                            </span>
                          )}
                        </DialogTitle>
                        <DialogDescription className="text-[14px] text-[#64748b] mt-1.5 font-sans relative z-10">
                          {showDraftBuilder
                            ? 'Answer these basics and Kimi K2 will generate a traditional JD template.'
                            : 'Generated by Kimi K2 from your inputs.'}
                        </DialogDescription>
                      </div>

                      <div className="max-h-[calc(90vh-100px)] overflow-y-auto px-8 py-7 space-y-6">
                        {showDraftBuilder ? (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Company Stage</label>
                                <Input
                                  value={draftForm.companyStage}
                                  onChange={(e) => handleDraftFieldChange('companyStage', e.target.value)}
                                  placeholder="e.g. Series A"
                                  className="h-[48px] rounded-[16px] border-[#e2e8f0] bg-white text-[14px] px-4 shadow-sm focus-visible:border-[#0f172a] focus-visible:ring-1 focus-visible:ring-[#0f172a] transition-all"
                                />
                              </div>
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Employment Type</label>
                                <Input
                                  value={draftForm.employmentType}
                                  onChange={(e) => handleDraftFieldChange('employmentType', e.target.value)}
                                  placeholder="e.g. Full-time"
                                  className="h-[48px] rounded-[16px] border-[#e2e8f0] bg-white text-[14px] px-4 shadow-sm focus-visible:border-[#0f172a] focus-visible:ring-1 focus-visible:ring-[#0f172a] transition-all"
                                />
                              </div>
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Location Policy</label>
                                <Input
                                  value={draftForm.locationPolicy}
                                  onChange={(e) => handleDraftFieldChange('locationPolicy', e.target.value)}
                                  placeholder="e.g. Remote"
                                  className="h-[48px] rounded-[16px] border-[#e2e8f0] bg-white text-[14px] px-4 shadow-sm focus-visible:border-[#0f172a] focus-visible:ring-1 focus-visible:ring-[#0f172a] transition-all"
                                />
                              </div>
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Compensation Range</label>
                                <Input
                                  value={draftForm.compensationRange}
                                  onChange={(e) => handleDraftFieldChange('compensationRange', e.target.value)}
                                  placeholder="e.g. $120k - $150k"
                                  className="h-[48px] rounded-[16px] border-[#e2e8f0] bg-white text-[14px] px-4 shadow-sm focus-visible:border-[#0f172a] focus-visible:ring-1 focus-visible:ring-[#0f172a] transition-all"
                                />
                              </div>
                            </div>

                            <div className="space-y-5">
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Must-Have Requirements</label>
                                <textarea
                                  value={draftForm.mustHaveRequirements}
                                  onChange={(e) => handleDraftFieldChange('mustHaveRequirements', e.target.value)}
                                  placeholder="Comma separated list"
                                  className="w-full min-h-[96px] rounded-[16px] border border-[#e2e8f0] bg-white px-4 py-3 text-[14px] text-[#334155] shadow-sm focus:outline-none focus:ring-1 focus:border-[#0f172a] focus:ring-[#0f172a] transition-all"
                                />
                              </div>
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Preferred Requirements</label>
                                <textarea
                                  value={draftForm.preferredRequirements}
                                  onChange={(e) => handleDraftFieldChange('preferredRequirements', e.target.value)}
                                  placeholder="Comma separated list"
                                  className="w-full min-h-[96px] rounded-[16px] border border-[#e2e8f0] bg-white px-4 py-3 text-[14px] text-[#334155] shadow-sm focus:outline-none focus:ring-1 focus:border-[#0f172a] focus:ring-[#0f172a] transition-all"
                                />
                              </div>
                              <div>
                                <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Core Responsibilities</label>
                                <textarea
                                  value={draftForm.coreResponsibilities}
                                  onChange={(e) => handleDraftFieldChange('coreResponsibilities', e.target.value)}
                                  placeholder="What will they do day-to-day?"
                                  className="w-full min-h-[96px] rounded-[16px] border border-[#e2e8f0] bg-white px-4 py-3 text-[14px] text-[#334155] shadow-sm focus:outline-none focus:ring-1 focus:border-[#0f172a] focus:ring-[#0f172a] transition-all"
                                />
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div>
                                  <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Nice-to-Have Skills</label>
                                  <textarea
                                    value={draftForm.niceToHave}
                                    onChange={(e) => handleDraftFieldChange('niceToHave', e.target.value)}
                                    placeholder="Bonus points..."
                                    className="w-full min-h-[96px] rounded-[16px] border border-[#e2e8f0] bg-white px-4 py-3 text-[14px] text-[#334155] shadow-sm focus:outline-none focus:ring-1 focus:border-[#0f172a] focus:ring-[#0f172a] transition-all"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Benefits and Perks</label>
                                  <textarea
                                    value={draftForm.benefits}
                                    onChange={(e) => handleDraftFieldChange('benefits', e.target.value)}
                                    placeholder="Health, equity, 401k..."
                                    className="w-full min-h-[96px] rounded-[16px] border border-[#e2e8f0] bg-white px-4 py-3 text-[14px] text-[#334155] shadow-sm focus:outline-none focus:ring-1 focus:border-[#0f172a] focus:ring-[#0f172a] transition-all"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-4 pb-2 border-t border-[#f1f5f9] mt-6">
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setShowDraftBuilder(false);
                                  setIsStep3ModalOpen(false);
                                }}
                                disabled={isParsing}
                                className="h-11 rounded-full px-6 text-[14px] text-[#64748b] hover:text-[#0f172a] hover:bg-[#f8fafc] transition-all border border-transparent hover:border-[#e2e8f0]"
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={() => void synthesizeDraftWithAi()}
                                disabled={isParsing}
                                className="h-11 rounded-[20px] px-6 bg-[#0f172a] hover:bg-[#1e293b] text-white text-[14px] font-medium shadow-md transition-all gap-2"
                              >
                                {isParsing ? 'Synthesizing...' : 'Generate with Kimi K2'}
                                {!isParsing && <HugeIcon icon={SparklesIcon} size={16} className="text-[#e18131]" />}
                              </Button>
                            </div>
                          </>
                        ) : jdSynthesis ? (
                          <div className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                              <div className="bg-[#f8fafc] rounded-[20px] p-4 border border-[#e2e8f0]/60">
                                <div className="text-[12px] font-sans font-medium text-[#64748b] mb-1">Role</div>
                                <div className="text-[15px] font-medium text-[#0f172a] line-clamp-1" title={jdSynthesis.title}>{jdSynthesis.title}</div>
                              </div>
                              <div className="bg-[#f8fafc] rounded-[20px] p-4 border border-[#e2e8f0]/60">
                                <div className="text-[12px] font-sans font-medium text-[#64748b] mb-1">Department</div>
                                <div className="text-[15px] font-medium text-[#0f172a] line-clamp-1" title={jdSynthesis.department}>{jdSynthesis.department}</div>
                              </div>
                              <div className="bg-[#f8fafc] rounded-[20px] p-4 border border-[#e2e8f0]/60">
                                <div className="text-[12px] font-sans font-medium text-[#64748b] mb-1">Compensation</div>
                                <div className="text-[15px] text-[#334155] line-clamp-1" title={jdSynthesis.compensation}>{jdSynthesis.compensation}</div>
                              </div>
                              <div className="bg-[#f8fafc] rounded-[20px] p-4 border border-[#e2e8f0]/60">
                                <div className="text-[12px] font-sans font-medium text-[#64748b] mb-1">Location</div>
                                <div className="text-[15px] text-[#334155] line-clamp-1" title={jdSynthesis.location}>{jdSynthesis.location}</div>
                              </div>
                            </div>
                            
                            <div className="bg-[#f8fafc] rounded-[20px] p-4 border border-[#e2e8f0]/60 flex items-center justify-between">
                              <div>
                                <div className="text-[12px] font-sans font-medium text-[#64748b] mb-1">Employment Type</div>
                                <div className="text-[15px] text-[#334155]">{jdSynthesis.employmentType}</div>
                              </div>
                            </div>

                            <div className="bg-white rounded-[24px] border border-[#e2e8f0] p-6 shadow-sm">
                              <div className="text-[14px] font-heading font-semibold text-[#0f172a] mb-3">Role Summary</div>
                              <p className="text-[14px] text-[#475569] leading-relaxed">{jdSynthesis.roleSummary}</p>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              <div className="bg-white rounded-[24px] border border-[#e2e8f0] p-6 shadow-sm">
                                <div className="text-[14px] font-heading font-semibold text-[#0f172a] mb-4">Responsibilities</div>
                                <ul className="space-y-3">
                                  {jdSynthesis.responsibilities.map((item, index) => (
                                    <li key={`resp-${index}`} className="flex items-start gap-3 text-[14px] text-[#475569] leading-relaxed">
                                      <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[#cbd5e1] shrink-0" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div className="bg-white rounded-[24px] border border-[#e2e8f0] p-6 shadow-sm">
                                <div className="text-[14px] font-heading font-semibold text-[#0f172a] mb-4">Requirements</div>
                                <ul className="space-y-3">
                                  {jdSynthesis.requirements.map((item, index) => (
                                    <li key={`req-${index}`} className="flex items-start gap-3 text-[14px] text-[#475569] leading-relaxed">
                                      <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[#cbd5e1] shrink-0" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div className="bg-white rounded-[24px] border border-[#e2e8f0] p-6 shadow-sm">
                                <div className="text-[14px] font-heading font-semibold text-[#0f172a] mb-4">Preferred Qualifications</div>
                                <ul className="space-y-3">
                                  {jdSynthesis.preferredQualifications.map((item, index) => (
                                    <li key={`pref-${index}`} className="flex items-start gap-3 text-[14px] text-[#475569] leading-relaxed">
                                      <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[#cbd5e1] shrink-0" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div className="bg-white rounded-[24px] border border-[#e2e8f0] p-6 shadow-sm">
                                <div className="text-[14px] font-heading font-semibold text-[#0f172a] mb-4">Benefits</div>
                                <ul className="space-y-3">
                                  {jdSynthesis.benefits.map((item, index) => (
                                    <li key={`benefit-${index}`} className="flex items-start gap-3 text-[14px] text-[#475569] leading-relaxed">
                                      <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[#cbd5e1] shrink-0" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            <div className="bg-[#fafafa] rounded-[24px] border border-[#e2e8f0] p-6 shadow-inner">
                              <div className="flex items-center gap-2 mb-4">
                                <HugeIcon icon={SparklesIcon} size={18} className="text-[#e18131]" />
                                <div className="text-[14px] font-heading font-semibold text-[#0f172a]">Extracted Hiring Signals</div>
                              </div>
                              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {jdSynthesis.hiringSignals.map((item, index) => (
                                  <li key={`signal-${index}`} className="bg-white border border-[#e2e8f0] rounded-[12px] px-4 py-2.5 flex items-center gap-3 text-[13px] font-medium text-[#334155] shadow-sm">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#e18131]" />
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-12 text-center h-[300px]">
                            <div className="w-16 h-16 rounded-full bg-[#f8fafc] border border-[#e2e8f0] flex items-center justify-center mb-4">
                              <HugeIcon icon={SparklesIcon} size={24} className="text-[#94a3b8]" />
                            </div>
                            <div className="text-[16px] font-medium text-[#0f172a] mb-1.5">No Draft Content</div>
                            <div className="text-[14px] text-[#64748b] max-w-[300px]">Provide job details or upload a job description to generate a template.</div>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col">
              <div className="bg-white p-8 rounded-[28px] border border-[#e2e8f0] shadow-[0_4px_24px_rgba(0,0,0,0.02)] mb-8">
                <div className="flex items-center justify-between mb-8">
                  <div className="font-heading font-medium text-[18px] text-[#0f172a]">Number of Rounds</div>
                  <div className="flex items-center gap-4">
                    <button onClick={() => setRounds(Math.max(1, rounds - 1))} className="w-8 h-8 rounded-full border border-[#cbd5e1] flex items-center justify-center hover:bg-[#f8fafc]">-</button>
                    <span className="text-[20px] font-heading font-semibold w-6 text-center">{rounds}</span>
                    <button onClick={() => setRounds(Math.min(5, rounds + 1))} className="w-8 h-8 rounded-full border border-[#cbd5e1] flex items-center justify-center hover:bg-[#f8fafc]">+</button>
                  </div>
                </div>

                <div className="flex gap-2 mb-8">
                  {Array.from({length: rounds}).map((_, i) => (
                    <div key={i} className="flex-1 h-3 rounded-full bg-gradient-to-r from-[#e18131] to-[#fecaca] opacity-80" />
                  ))}
                  {Array.from({length: 5 - rounds}).map((_, i) => (
                    <div key={i} className="flex-1 h-3 rounded-full bg-[#f1f5f9]" />
                  ))}
                </div>

                <div className="pt-6 border-t border-[#f1f5f9]">
                  <div className="text-[14px] font-sans font-medium text-[#1e293b] mb-4">Hiring Signals (Select key priorities)</div>
                  <div className="flex flex-wrap gap-2">
                    {['Zero-to-One Experience', 'System Design', 'Culture Fit', 'Management', 'Code Craft', 'Speed of Execution'].map(chip => {
                      const active = hiringChips.includes(chip);
                      return (
                        <button 
                          key={chip}
                          onClick={() => toggleChip(chip)}
                          className={cn(
                            "px-4 py-2 rounded-full text-[13px] font-medium transition-all border",
                            active ? "bg-[#0f172a] text-white border-[#0f172a] shadow-md" : "bg-white text-[#64748b] border-[#cbd5e1] hover:border-[#94a3b8]"
                          )}
                        >
                          {chip}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col">
              <div className="bg-white p-8 rounded-[28px] border border-[#e2e8f0] shadow-[0_4px_24px_rgba(0,0,0,0.02)] space-y-8">
                
                <div>
                  <label className="block text-[14px] font-sans font-medium text-[#1e293b] mb-4">Who approves final offers?</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {['Founder', 'Hiring Manager', 'Auto'].map(gate => (
                      <button
                        key={gate}
                        onClick={() => setGateAction(gate as any)}
                        className={cn(
                          "px-4 py-3 border rounded-[16px] text-[13px] font-medium transition-all duration-300",
                          gateAction === gate ? "bg-[#f8fafc] border-[#0f172a] text-[#0f172a] shadow-[0_2px_8px_rgba(0,0,0,0.04)]" : "bg-white border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                        )}
                      >
                        {gate} {gate === 'Founder' && <HugeIcon icon={SecurityCheckIcon} size={14} className="inline ml-1 text-[#e18131]" />}
                      </button>
                    ))}
                  </div>
                  {gateAction === 'Auto' && (
                    <p className="text-[12px] text-red-500 mt-2 font-medium">Warning: Offers will be sent immediately upon round success.</p>
                  )}
                </div>

                <div>
                  <label className="block text-[14px] font-sans font-medium text-[#1e293b] mb-2">Base Compensation Ceiling</label>
                  <p className="text-[12px] text-[#64748b] mb-4">The Dispatch agent will negotiate up to this number for the {jobTitle || 'selected'} role.</p>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94a3b8] font-heading text-[16px]">$</span>
                    <Input 
                      value={compRange}
                      onChange={e => setCompRange(e.target.value)}
                      placeholder="e.g. 150,000"
                      className="h-[56px] rounded-[16px] text-[16px] pl-8 border-[#e2e8f0] focus-visible:ring-[#0f172a]"
                    />
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>

      {/* Static Footer Navigation */}
      <div className="w-full max-w-[640px] z-10 relative mt-auto flex items-center justify-between pt-8 mb-4">
        <Button 
          variant="ghost" 
          disabled={step === 1}
          className="text-[#64748b] text-[14px] hover:text-[#0f172a] disabled:opacity-0 transition-opacity" 
          onClick={() => setStep(step - 1)}
        >
          Back
        </Button>
        
        {step < 5 ? (
          <Button 
            disabled={
              (step === 1 && (!role || !orgName)) ||
              (step === 2 && (connectionsLoading || !allRequiredConnected)) ||
              (step === 3 && !jobTitle)
            }
            onClick={() => setStep(step + 1)}
            className="w-[200px] bg-[#e18131] hover:bg-[#c76922] text-white rounded-[20px] h-[56px] text-[15px] font-medium transition-all shadow-sm disabled:opacity-30"
          >
            Next Step
          </Button>
        ) : (
          <Button 
            onClick={finishOnboarding}
            disabled={isFinalizing || connectionsLoading || !allRequiredConnected}
            className="w-[240px] bg-[#e18131] hover:bg-[#c76922] text-white rounded-[20px] h-[56px] text-[15px] font-medium transition-all shadow-sm group"
          >
            {isFinalizing ? 'Finalizing...' : 'Enter Dashboard'}
          </Button>
        )}
      </div>
      
    </div>
  );
}
