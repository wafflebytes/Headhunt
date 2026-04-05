"use client";
import { useUser } from "@/app/api-mock";
import {
  Building02Icon,
  CheckmarkCircle02Icon,
  Tick02Icon,
  User03Icon,
  SparklesIcon,
  SecurityCheckIcon,
  FileUploadIcon,
  File01Icon
} from '@hugeicons/core-free-icons';
import { useQuery, useMutation } from "@/app/api-mock";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export default function OnboardingPage() {
  const { user } = useUser();
  const [step, setStep] = useState(1);
  
  // State for Step 1
  const [role, setRole] = useState<'founder' | 'hr' | 'manager' | null>(null);
  const [orgName, setOrgName] = useState('');

  // State for Step 2
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [agentIdx, setAgentIdx] = useState(0);

  useEffect(() => {
    if (step === 2) {
      const timer = setInterval(() => {
        setAgentIdx(prev => (prev + 1) % AGENT_STORIES.length);
      }, 2500); // 2.5s to give them time to read
      return () => clearInterval(timer);
    }
  }, [step]);

  // State for Step 3
  const [jobTitle, setJobTitle] = useState('');
  const [jobDept, setJobDept] = useState('');
  const [showTitleOptions, setShowTitleOptions] = useState(false);
  const [showDeptOptions, setShowDeptOptions] = useState(false);
  
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

  const finishOnboarding = () => {
    document.cookie = "headhunt_onboarded=true; path=/; max-age=31536000";
    window.location.href = '/';
  };

  const handleConnect = (id: string) => {
    setConnected(prev => ({ ...prev, [id]: true }));
    toast.success(`${id} connected successfully.`);
  };

  const toggleChip = (chip: string) => {
    setHiringChips(prev => prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setIsParsing(true);
    
    // Mock parsing delay
    setTimeout(() => {
      setJobTitle('Staff ML Engineer');
      setJobDept('Engineering');
      setIsParsing(false);
      setIsParsed(true);
      toast.success('Successfully extracted JD details');
    }, 2000);
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
                           <img src={agent.src} className="w-10 h-10 object-contain drop-shadow-sm" alt={agent.name} />
                           <span className={cn("text-[13px] font-bold uppercase tracking-wider", agent.color)}>{agent.name}</span>
                         </div>
                         
                         {/* Skeuomorphic Bubble */}
                         <div className="bg-gradient-to-b from-[#ffffff] to-[#f8fafc] border border-[#cbd5e1] shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_6px_16px_rgba(15,23,42,0.06)] p-6 rounded-[24px] rounded-tl-[12px] relative max-w-[280px] w-full ring-1 ring-black/[0.03]">
                           <div className="absolute -top-[8px] left-[26px] w-4 h-4 bg-[#ffffff] border-t border-l border-[#cbd5e1] shadow-[inset_1px_1px_1px_rgba(255,255,255,0.9)] rotate-45" />
                           <p className="text-[15px] text-[#334155] font-medium leading-relaxed relative z-10 drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
                             "{agent.quote}"
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
                  {INTEGRATIONS.map(item => (
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
                      {connected[item.id] ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#f0fdf4] text-[#10b981] text-[12px] font-medium border border-[#bbf7d0]">
                          <HugeIcon icon={Tick02Icon} size={14} /> Synced
                        </div>
                      ) : (
                        <Button 
                          variant="outline" 
                          onClick={() => handleConnect(item.id)}
                          className="rounded-full h-8 text-[12px] px-4 border-[#e2e8f0] text-[#475569] hover:text-[#0f172a] hover:border-[#0f172a] transition-all"
                        >
                          Connect
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col">
              <div className="space-y-6 bg-white p-8 rounded-[28px] border border-[#e2e8f0] shadow-[0_4px_24px_rgba(0,0,0,0.02)] relative overflow-visible">
                
                <div className="relative">
                  <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Job Title</label>
                  <Input 
                    value={jobTitle}
                    onChange={e => { setJobTitle(e.target.value); setShowTitleOptions(true); }}
                    onFocus={() => setShowTitleOptions(true)}
                    onBlur={() => setTimeout(() => setShowTitleOptions(false), 200)}
                    placeholder="e.g. Senior Product Designer"
                    className="h-[56px] rounded-[16px] text-[16px] border-[#e2e8f0] focus-visible:ring-[#0f172a]"
                  />
                  {/* Combobox logic */}
                  {showTitleOptions && jobTitle.length > 0 && !JOB_TITLES.includes(jobTitle) && (
                    <div className="absolute top-[82px] left-0 w-full bg-white border border-[#e2e8f0] rounded-[14px] shadow-lg overflow-hidden z-20">
                      {JOB_TITLES.filter(t => t.toLowerCase().includes(jobTitle.toLowerCase())).map(t => (
                        <div key={t} className="px-4 py-3 text-[14px] hover:bg-[#f8fafc] cursor-pointer" onClick={() => setJobTitle(t)}>
                          {t}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <label className="block text-[12px] font-sans font-medium text-[#64748b] mb-2 px-1">Department</label>
                  <Input 
                    value={jobDept}
                    onChange={e => { setJobDept(e.target.value); setShowDeptOptions(true); }}
                    onFocus={() => setShowDeptOptions(true)}
                    onBlur={() => setTimeout(() => setShowDeptOptions(false), 200)}
                    placeholder="e.g. Platform Engineering"
                    className="h-[56px] rounded-[16px] text-[16px] border-[#e2e8f0] focus-visible:ring-[#0f172a]"
                  />
                  {showDeptOptions && (
                    <div className="absolute top-[82px] left-0 w-full bg-white border border-[#e2e8f0] rounded-[14px] shadow-lg overflow-hidden z-20">
                      {DEPTS.filter(d => d.toLowerCase().includes(jobDept.toLowerCase())).map(d => (
                        <div key={d} className="px-4 py-3 text-[14px] hover:bg-[#f8fafc] cursor-pointer" onClick={() => setJobDept(d)}>
                          {d}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Drag and Drop Zone */}
                <div 
                  className={cn(
                    "border-2 border-dashed rounded-[20px] transition-all duration-300 flex flex-col items-center justify-center text-center px-4",
                    isParsed ? "hidden" : isDragging ? "bg-[#f8fafc] border-[#0f172a] h-[160px]" : "border-[#e2e8f0] hover:border-[#cbd5e1] hover:bg-[#fcfdfe] h-[120px]"
                  )}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                   {isParsing ? (
                     <div className="flex flex-col items-center animate-pulse gap-3">
                       <HugeIcon icon={SparklesIcon} size={28} className="text-[#e18131] animate-spin-slow" />
                       <div className="text-[14px] font-medium text-[#0f172a]">Analyst is parsing document...</div>
                     </div>
                   ) : (
                     <div className="flex flex-col items-center gap-3">
                       <div className="w-10 h-10 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#94a3b8]">
                         <HugeIcon icon={FileUploadIcon} size={20} />
                       </div>
                       <div>
                         <span className="text-[14px] font-medium text-[#0f172a]">Drop a Job Description PDF</span>
                       </div>
                     </div>
                   )}
                </div>

                {isParsed && (
                  <div className="px-4 py-3 bg-[#f0fdf4] border border-[#bbf7d0] rounded-[16px] flex items-center gap-3 animate-in zoom-in duration-300">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-[#10b981] shadow-sm"><HugeIcon icon={File01Icon} size={16} /></div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-[#166534]">Document Parsed Successfully</div>
                      <div className="text-[12px] text-[#166534]/80">Fields auto-filled. You can modify them below.</div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-2">
                  <div className="h-px bg-[#f1f5f9] flex-1"></div>
                  <div className="text-[12px] font-medium text-[#94a3b8]">OR</div>
                  <div className="h-px bg-[#f1f5f9] flex-1"></div>
                </div>

                <div className="flex justify-center">
                  <Button 
                    variant="ghost"
                    onClick={() => toast('Analyst agent is automatically drafting the JD...', { icon: '✨' })}
                    className="gap-2 text-[#64748b] hover:text-[#0f172a] hover:bg-[#f8fafc] rounded-full h-9 px-4 text-[12px] border border-[#e2e8f0] transition-all w-full"
                  >
                    <HugeIcon icon={SparklesIcon} size={14} className="text-[#e18131]" />
                    Draft JD automatically with AI
                  </Button>
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
            disabled={(step === 1 && (!role || !orgName)) || (step === 3 && !jobTitle)}
            onClick={() => setStep(step + 1)}
            className="w-[200px] bg-[#e18131] hover:bg-[#c76922] text-white rounded-[20px] h-[56px] text-[15px] font-medium transition-all shadow-sm disabled:opacity-30"
          >
            Next Step
          </Button>
        ) : (
          <Button 
            onClick={finishOnboarding}
            className="w-[240px] bg-[#e18131] hover:bg-[#c76922] text-white rounded-[20px] h-[56px] text-[15px] font-medium transition-all shadow-sm group"
          >
            Enter Dashboard
          </Button>
        )}
      </div>
      
    </div>
  );
}
