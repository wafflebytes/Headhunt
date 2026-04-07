import re

with open('src/app/page.tsx', 'r') as f:
    text = f.read()

# We need to replace function JobsScreen() and function CandidatesScreen() components.

new_jobs_screen = '''function JobsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Modal State
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [jobDept, setJobDept] = useState('');
  const [showTitleOptions, setShowTitleOptions] = useState(false);
  const [showDeptOptions, setShowDeptOptions] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isParsed, setIsParsed] = useState(false);
  const JOB_TITLES = ['Software Engineer', 'Senior Software Engineer', 'Staff ML Engineer', 'Product Designer', 'Senior Product Designer', 'Product Manager', 'Founding Product Manager'];
  const DEPTS = ['Engineering', 'Design', 'Product', 'Marketing', 'Sales', 'Operations'];

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

  const initialJobs = [
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

  const [jobs, setJobs] = useState(initialJobs);

  const jobMatch = pathname.match(/^\\/jobs\\/([^/]+)$/);
  const currentJobSlug = jobMatch?.[1] ?? null;
  const currentJob = jobs.find((job) => job.slug === currentJobSlug);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setIsParsing(true);
    setTimeout(() => {
      setJobTitle('Staff ML Engineer');
      setJobDept('Engineering');
      setIsParsing(false);
      setIsParsed(true);
    }, 2000);
  };

  const handleCreateJob = () => {
     if (!jobTitle) return;
     const slug = jobTitle.toLowerCase().replace(/\\s+/g, '-');
     const newJob = {
       id: `job_new_${Date.now()}`,
       slug,
       title: jobTitle,
       team: jobDept || 'Engineering',
       openedAt: 'Opened just now',
       status: 'draft',
       statusClass: 'bg-[#f8fafc] text-[#475569] border-[#e2e8f0]',
       applied: 0,
       reviewed: 0,
       interviewed: 0,
       manager: 'You',
     };
     setJobs(prev => [newJob, ...prev]);
     setShowNewJobModal(false);
     setJobTitle('');
     setJobDept('');
     setIsParsed(false);
  }

  if (jobMatch && currentJob) {
    return (
      <div className="flex flex-col gap-5 max-w-[1020px] w-full mx-auto pb-10">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4">
          <div>
            <div className="text-[20px] font-heading font-medium text-[#1e293b]">{currentJob.title}</div>
            <div className="text-[13px] font-sans text-[#64748b]">{currentJob.team} · {currentJob.manager} · {currentJob.openedAt}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push(`/candidates?job=${currentJob.slug}`)}>
              Candidates
            </Button>
            <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push('/jobs')}>
              Back to Jobs
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Applied</div><div className="text-[26px] font-sans text-[#0f172a] mt-1">{currentJob.applied}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Reviewed</div><div className="text-[26px] font-sans text-[#0f172a] mt-1">{currentJob.reviewed}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Interviewed</div><div className="text-[26px] font-sans text-[#0f172a] mt-1">{currentJob.interviewed}</div></CardContent></Card>
          <Card className="rounded-[14px] border border-[#e2e8f0] shadow-sm"><CardContent className="p-4"><div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-heading">Status</div><Badge className={cn('mt-2 text-[10px] uppercase border shadow-none', currentJob.statusClass)}>{currentJob.status}</Badge></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm lg:col-span-2">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[14px] font-sans font-semibold text-[#1e293b]">Job Function & JD Parsed</div>
                <Badge className="bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0] hover:bg-[#f0fdf4] shadow-none text-[10px] font-medium"><HugeIcon icon={File01Icon} size={12} className="mr-1" /> Synthesized Profile</Badge>
              </div>
              <div className="text-[13px] font-sans text-[#475569] leading-relaxed mb-4">
                We are looking for a {currentJob.title} to join our {currentJob.team} team. The ideal candidate has deep expertise in scaling infrastructure, zero-to-one product development, and strong cross-functional communication skills.
              </div>
              <div className="space-y-2 text-[12px] font-sans text-[#64748b]">
                <div className="rounded-[10px] border border-[#e2e8f0] p-3 flex gap-3">
                  <div className="w-1.5 h-1.5 bg-[#e18131] rounded-full mt-1.5 shrink-0" />
                  <span>Build and iterate rapidly on core product functionality, collaborating closely with design and executive teams.</span>
                </div>
                <div className="rounded-[10px] border border-[#e2e8f0] p-3 flex gap-3">
                  <div className="w-1.5 h-1.5 bg-[#e18131] rounded-full mt-1.5 shrink-0" />
                  <span>Establish best practices for architecture and code quality inside the designated domain area.</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
            <CardContent className="p-5">
              <div className="text-[14px] font-sans font-semibold text-[#1e293b] mb-3">Action Rail</div>
              <div className="flex flex-col gap-2">
                <Button className="h-8 rounded-full bg-[#1e293b] hover:bg-[#0f172a] text-white text-[12px]">Edit Details</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]" onClick={() => router.push(`/candidates?job=${currentJob.slug}`)}>View Filtered Candidates</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Change Timeline</Button>
                <Button variant="outline" className="h-8 rounded-full border-[#cbd5e1] text-[12px]">Archive Role</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[16px] border border-[#e2e8f0] shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4 border-b border-[#e2e8f0] pb-4">
              <div className="text-[14px] font-sans font-semibold text-[#1e293b]">Offer Letter Configuration</div>
              <Button size="sm" variant="outline" className="h-7 text-[11px] rounded-full border-[#cbd5e1]">Edit Template</Button>
            </div>
            
            <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[12px] p-6 font-serif">
              <div className="text-[18px] font-semibold text-[#0f172a] mb-2">{currentJob.title} Offer Agreement</div>
              <div className="text-[12px] text-[#64748b] font-sans mb-6">Generated by Dispatch Agent</div>
              
              <div className="w-full h-px bg-[#e2e8f0] my-4" />
              
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-sans font-bold mb-1">Compensation</div>
                <div className="text-[14px] text-[#334155] whitespace-pre-wrap">Base Salary limit pre-configured up to $160,000 USD / yr. \nEquity parameters standardized for {currentJob.team} band.</div>
              </div>

              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-sans font-bold mb-1">Location & Requirements</div>
                <div className="text-[14px] text-[#334155] whitespace-pre-wrap">Remote / Hybrid flexibility. \nStandard 4-year vesting schedule, 1-year cliff.</div>
              </div>
            </div>
          </CardContent>
        </Card>
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
          <Button className="h-8 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white text-[12px]" onClick={() => setShowNewJobModal(true)}>
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
                  <Button size="sm" variant="outline" className="h-7 rounded-full border-[#cbd5e1] text-[11px]" onClick={() => router.push(`/candidates?job=${job.slug}`)}>Candidates</Button>
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

      <Dialog open={showNewJobModal} onOpenChange={setShowNewJobModal}>
        <DialogContent className="max-w-[640px] p-0 rounded-[28px] overflow-visible border-[#e2e8f0] font-sans outline-none focus:outline-none">
          <VisuallyHidden><DialogTitle>New Job Configuration</DialogTitle></VisuallyHidden>
          <div className="flex flex-col">
            <div className="space-y-6 bg-white p-8 rounded-[28px] shadow-none relative overflow-visible">
              <div>
                <div className="text-[24px] font-heading font-medium text-[#1e293b]">Open a requisition</div>
                <div className="text-[14px] font-sans text-[#64748b]">Set up your role. You can configure Offer Letters later inside the job sub-page.</div>
              </div>
              
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
                  onClick={() => { setJobTitle('Generated Role'); setIsParsed(true); }}
                  className="gap-2 text-[#64748b] hover:text-[#0f172a] hover:bg-[#f8fafc] rounded-full h-9 px-4 text-[12px] border border-[#e2e8f0] transition-all w-full"
                >
                  <HugeIcon icon={SparklesIcon} size={14} className="text-[#e18131]" />
                  Draft JD automatically with AI
                </Button>
              </div>
              
              <div className="flex justify-end pt-4">
                <Button onClick={handleCreateJob} disabled={!jobTitle} className="h-10 rounded-full bg-[#e18131] hover:bg-[#c76922] text-white px-6">
                  Create Job
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}'''

new_candidates_screen = '''function CandidatesScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const initialJobQuery = searchParams.get('job');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialJobQuery || '');

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

  const candidateMatch = pathname.match(/^\\/candidates\\/([^/]+)$/);
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
              placeholder="Search by name, role, source, or job match..." 
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
              !candidate.jobId.toLowerCase().includes(searchQuery.toLowerCase()) &&
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
          const matchesScore = scoreFilters.length === 0 || scoreFilters.some(f => {
            if (f === 'score-90') return candidate.score >= 90;
            if (f === 'score-80') return candidate.score >= 80;
            return false;
          });

          const ownerFilters = activeFilters.filter(f => f.startsWith('owner-'));
          const matchesOwner = ownerFilters.length === 0 || ownerFilters.some(f => {
            if (f === 'owner-triage') return candidate.owner === 'Triage';
            if (f === 'owner-liaison') return candidate.owner === 'Liaison';
            if (f === 'owner-analyst') return candidate.owner === 'Analyst';
            if (f === 'owner-dispatch') return candidate.owner === 'Dispatch';
            return false;
          });

          return matchesRole && matchesStage && matchesScore && matchesOwner;
        }).map(candidate => (
          <div key={candidate.id} className="grid grid-cols-12 gap-3 px-5 py-4 border-b border-[#f1f5f9] items-center hover:bg-[#fdfdfd] cursor-pointer" onClick={() => router.push(`/candidates/${candidate.id}`)}>
            <div className="col-span-3">
              <div className="text-[13px] font-sans font-medium text-[#1e293b]">{candidate.name}</div>
              <div className="text-[11px] font-sans text-[#94a3b8] truncate">{candidate.source}</div>
            </div>
            <div className="col-span-2 text-[12px] font-sans text-[#475569]">{candidate.role}</div>
            <div className="col-span-2 flex gap-0.5">
              {candidate.confidence.map((val, i) => (
                <div key={i} className={cn("w-1.5 h-4 rounded-sm", val === 1 ? "bg-[#10b981]" : "bg-[#f1f5f9]")} />
              ))}
            </div>
            <div className="col-span-1 text-left text-[14px] font-sans font-medium text-[#0f172a]">{candidate.score}</div>
            <div className="col-span-2 text-[12px] font-sans text-[#64748b]"><Badge className="bg-[#f8fafc] text-[#475569] text-[10px] shadow-none border-[#e2e8f0] font-medium">{candidate.stage.replace('_', ' ')}</Badge></div>
            <div className="col-span-2 text-left">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#f8fafc] border border-[#e2e8f0]">
                <img src={HEADIE_AGENT_VISUALS[resolveHeadieAgentKey(candidate.owner)].coloredSrc} className="w-3.5 h-3.5 object-contain" alt="" />
                <span className="text-[11px] font-bold text-[#64748b] tracking-wide uppercase">{candidate.owner}</span>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}'''

# Find boundaries and replace it
jobs_start = text.find("function JobsScreen() {")
candidates_start = text.find("function CandidatesScreen() {")

# To accurately find the end, I'll find function AgentsScreen()
agents_start = text.find("function AgentsScreen() {")

if jobs_start != -1 and candidates_start != -1 and agents_start != -1:
    new_text = text[:jobs_start] + new_jobs_screen + "\n\n" + new_candidates_screen + "\n\n" + text[agents_start:]
    with open('src/app/page.tsx', 'w') as f:
        f.write(new_text)
    print("Replaced JobsScreen and CandidatesScreen")
else:
    print("Failed to find boundaries")
