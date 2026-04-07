import dotenv from 'dotenv';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { frontendMockSnapshots } from '@/lib/db/schema/frontend-mock-snapshots';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { offers } from '@/lib/db/schema/offers';
import { organizations } from '@/lib/db/schema/organizations';
import { templates } from '@/lib/db/schema/templates';
import { normalizeJdTemplate, type JdTemplate } from '@/lib/jd-template';

dotenv.config({ path: '.env.local' });
dotenv.config();

const shouldReset = process.argv.includes('--reset');
const candidateCountArg = process.argv.find(
  (arg) => arg.startsWith('--candidate-count=') || arg.startsWith('--candidates='),
);
const requestedCandidateCountRaw = candidateCountArg
  ? Number(candidateCountArg.split('=')[1])
  : Number(process.env.SEED_CANDIDATE_COUNT ?? 329);
const NOW = new Date('2026-04-06T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const DEMO_ORGANIZATION = {
  id: 'org_demo_headhunt',
  name: 'Headhunt Demo Labs',
};

type CandidateStage = 'applied' | 'reviewed' | 'interview_scheduled' | 'interviewed' | 'offer_sent' | 'hired' | 'rejected';
type ApplicationStatus = 'active' | 'inactive' | 'archived';
type InterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
type OfferStatus = 'draft' | 'awaiting_approval' | 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn';

type JobBlueprint = {
  id: string;
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
  scoringDimensions: string[];
  salaryRange: [number, number];
  equityRange: [number, number];
};

const JOB_BLUEPRINTS: JobBlueprint[] = [
  {
    id: 'job_demo_staff_backend_engineer',
    title: 'Staff Backend Engineer',
    department: 'Engineering',
    employmentType: 'Full-time',
    location: 'Hybrid (San Francisco) or US Remote',
    compensation: '$205,000 - $245,000 base + equity',
    roleSummary:
      'Own backend architecture for high-throughput hiring workflows spanning triage, scheduling, and approval orchestration.',
    responsibilities: [
      'Lead design of resilient APIs and event-driven pipelines powering candidate lifecycle automation.',
      'Partner with product and recruiting stakeholders to translate workflow pain points into reliable backend systems.',
      'Define observability guardrails and incident response runbooks for critical recruitment operations.',
    ],
    requirements: [
      '7+ years building production backend systems in TypeScript, Go, or similar.',
      'Hands-on experience designing queue-backed distributed workflows and idempotent job processors.',
      'Strong SQL and Postgres tuning experience, including schema design and index strategy.',
    ],
    preferredQualifications: [
      'Experience with Auth0, OAuth 2.1, or delegated authorization pipelines.',
      'Familiarity with AI-assisted automation and policy-bound action controls.',
      'Track record mentoring senior engineers and raising engineering quality bars.',
    ],
    benefits: ['Comprehensive medical coverage', '401k matching', 'Quarterly learning stipend', 'Remote setup allowance'],
    hiringSignals: ['System ownership depth', 'Operational excellence', 'Mentorship and technical judgment'],
    scoringDimensions: ['Backend Systems', 'Data Design', 'Operational Readiness'],
    salaryRange: [205000, 245000],
    equityRange: [0.15, 0.55],
  },
  {
    id: 'job_demo_senior_frontend_engineer',
    title: 'Senior Frontend Engineer',
    department: 'Engineering',
    employmentType: 'Full-time',
    location: 'US Remote',
    compensation: '$180,000 - $220,000 base + equity',
    roleSummary:
      'Craft high-velocity frontend experiences for recruiter workflows, candidate workbenches, and approvals dashboards.',
    responsibilities: [
      'Build polished, high-performance interfaces that keep hiring teams in flow during complex operations.',
      'Collaborate with design and product to translate fuzzy requirements into robust UI architecture.',
      'Own frontend reliability metrics and accessibility standards across mission-critical views.',
    ],
    requirements: [
      '5+ years shipping modern React or Next.js applications in production.',
      'Strong command of TypeScript, state modeling, and data synchronization patterns.',
      'Experience building design-system quality components and interaction-heavy surfaces.',
    ],
    preferredQualifications: [
      'Experience with realtime collaboration interfaces or operational dashboards.',
      'Strong visual polish instincts and practical animation/performance tradeoff judgment.',
      'Knowledge of AI-assisted UX patterns for workflow acceleration.',
    ],
    benefits: ['Comprehensive medical coverage', 'Annual home office refresh budget', 'Mental wellness stipend', 'Flexible PTO'],
    hiringSignals: ['Interaction quality', 'Frontend architecture rigor', 'Product collaboration strength'],
    scoringDimensions: ['UI Craft', 'State Management', 'Product Execution'],
    salaryRange: [180000, 220000],
    equityRange: [0.12, 0.4],
  },
  {
    id: 'job_demo_ai_research_engineer',
    title: 'AI Research Engineer',
    department: 'Applied AI',
    employmentType: 'Full-time',
    location: 'US Remote',
    compensation: '$195,000 - $240,000 base + equity',
    roleSummary:
      'Develop model-driven ranking, summarization, and decision-support systems that accelerate hiring outcomes safely.',
    responsibilities: [
      'Prototype and productionize retrieval and reasoning systems for candidate intelligence generation.',
      'Define evaluation harnesses for model quality, fairness, and operational stability.',
      'Collaborate with platform teams to deploy secure AI pipelines aligned with policy controls.',
    ],
    requirements: [
      'Strong experience with LLM application development and evaluation design.',
      'Ability to build performant data pipelines for embedding, retrieval, and ranking workloads.',
      'Comfort with experimentation frameworks and model monitoring in production.',
    ],
    preferredQualifications: [
      'Background in applied NLP, recommender systems, or ranking algorithms.',
      'Experience with prompt orchestration and deterministic guardrail design.',
      'Familiarity with confidential data handling in enterprise AI workflows.',
    ],
    benefits: ['Comprehensive medical coverage', 'Conference and publication support', 'GPU workstation stipend', 'Quarterly innovation days'],
    hiringSignals: ['Model quality rigor', 'Experimentation discipline', 'Safety-first implementation'],
    scoringDimensions: ['Modeling Depth', 'Evaluation Quality', 'Platform Integration'],
    salaryRange: [195000, 240000],
    equityRange: [0.14, 0.5],
  },
  {
    id: 'job_demo_principal_product_designer',
    title: 'Principal Product Designer',
    department: 'Design',
    employmentType: 'Full-time',
    location: 'Hybrid (San Francisco) or US Remote',
    compensation: '$175,000 - $215,000 base + equity',
    roleSummary:
      'Lead end-to-end product design for recruiter intelligence and orchestration flows with a strong systems-thinking lens.',
    responsibilities: [
      'Shape core product experiences from discovery through polished interaction design and implementation partnership.',
      'Define and evolve design system standards for consistency across high-complexity workflow surfaces.',
      'Facilitate cross-functional alignment on tradeoffs, experiment outcomes, and roadmap priorities.',
    ],
    requirements: [
      '8+ years in product design with strong portfolio depth across complex SaaS workflows.',
      'Proven ability to run discovery, synthesize insights, and ship high-quality interaction systems.',
      'Strong collaboration track record with engineering and product leadership.',
    ],
    preferredQualifications: [
      'Experience designing AI-assisted workflow products.',
      'Comfort with data-informed design iteration and experiment readouts.',
      'Strong mentorship and design leadership capabilities.',
    ],
    benefits: ['Comprehensive medical coverage', 'Design tools budget', 'Annual retreat stipend', 'Flexible PTO'],
    hiringSignals: ['Systems thinking', 'Interaction quality', 'Cross-functional leadership'],
    scoringDimensions: ['UX Strategy', 'Interaction Design', 'Collaboration Impact'],
    salaryRange: [175000, 215000],
    equityRange: [0.1, 0.35],
  },
  {
    id: 'job_demo_devops_platform_engineer',
    title: 'DevOps Platform Engineer',
    department: 'Platform',
    employmentType: 'Full-time',
    location: 'US Remote',
    compensation: '$185,000 - $225,000 base + equity',
    roleSummary:
      'Scale infrastructure, security, and delivery pipelines that keep hiring automation reliable and compliant.',
    responsibilities: [
      'Own CI/CD, infrastructure-as-code, and runtime reliability for customer-facing automation flows.',
      'Improve deployment safety through progressive delivery, rollback automation, and observability guardrails.',
      'Partner with security and backend teams to enforce least-privilege and secrets hygiene.',
    ],
    requirements: [
      '5+ years operating cloud-native infrastructure and production deployments.',
      'Experience with container orchestration, CI/CD design, and reliability engineering practices.',
      'Deep familiarity with monitoring, alerting, and incident response workflows.',
    ],
    preferredQualifications: [
      'Experience with Supabase, edge functions, or managed Postgres operations.',
      'Knowledge of compliance frameworks and audit-ready change controls.',
      'Strong automation mindset with infrastructure policy as code.',
    ],
    benefits: ['Comprehensive medical coverage', 'On-call stipend', 'Cloud training budget', 'Annual recharge week'],
    hiringSignals: ['Infrastructure ownership', 'Reliability mindset', 'Security-by-default execution'],
    scoringDimensions: ['Infrastructure Depth', 'Reliability Execution', 'Security Posture'],
    salaryRange: [185000, 225000],
    equityRange: [0.12, 0.42],
  },
];

const BASE_CANDIDATE_COUNT = 329;
const TARGET_CANDIDATE_COUNT =
  Number.isFinite(requestedCandidateCountRaw) && requestedCandidateCountRaw >= 50
    ? Math.floor(requestedCandidateCountRaw)
    : BASE_CANDIDATE_COUNT;

const BASE_JOB_CANDIDATE_COUNTS = [70, 67, 65, 61, 66];

const BASE_STAGE_TARGETS: Array<{ stage: CandidateStage; count: number }> = [
  { stage: 'applied', count: 66 },
  { stage: 'reviewed', count: 79 },
  { stage: 'interview_scheduled', count: 59 },
  { stage: 'interviewed', count: 53 },
  { stage: 'offer_sent', count: 33 },
  { stage: 'hired', count: 23 },
  { stage: 'rejected', count: 16 },
];

function scaleDistribution(baseCounts: number[], targetTotal: number): number[] {
  const baseTotal = baseCounts.reduce((sum, count) => sum + count, 0);

  if (targetTotal === baseTotal) {
    return [...baseCounts];
  }

  const scaledRaw = baseCounts.map((count) => (count / baseTotal) * targetTotal);
  const scaledFloor = scaledRaw.map((count) => Math.floor(count));
  let remainder = targetTotal - scaledFloor.reduce((sum, count) => sum + count, 0);

  const sortedFractions = scaledRaw
    .map((raw, index) => ({
      index,
      fraction: raw - scaledFloor[index],
    }))
    .sort((left, right) => right.fraction - left.fraction);

  let cursor = 0;
  while (remainder > 0) {
    const targetIndex = sortedFractions[cursor % sortedFractions.length]?.index;
    if (typeof targetIndex === 'number') {
      scaledFloor[targetIndex] += 1;
      remainder -= 1;
    }
    cursor += 1;
  }

  return scaledFloor;
}

const JOB_CANDIDATE_COUNTS = scaleDistribution(BASE_JOB_CANDIDATE_COUNTS, TARGET_CANDIDATE_COUNT);
const scaledStageCounts = scaleDistribution(
  BASE_STAGE_TARGETS.map((item) => item.count),
  TARGET_CANDIDATE_COUNT,
);
const STAGE_TARGETS = BASE_STAGE_TARGETS.map((entry, index) => ({
  stage: entry.stage,
  count: scaledStageCounts[index],
}));

const chunkSizeArg = process.argv.find((arg) => arg.startsWith('--chunk-size='));
const requestedChunkSize = chunkSizeArg
  ? Number(chunkSizeArg.split('=')[1])
  : Number(process.env.SEED_CHUNK_SIZE ?? 100);
const CHUNK_SIZE = Number.isFinite(requestedChunkSize) && requestedChunkSize > 0 ? Math.floor(requestedChunkSize) : 100;
const LOG_PREFIX = '[seed:demo]';

function logStep(message: string) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

const FIRST_NAMES = [
  'Aarav', 'Aisha', 'Akira', 'Amara', 'Anika', 'Arjun', 'Ava', 'Caleb', 'Camila', 'Daria', 'Deepa', 'Elias', 'Elena', 'Farah',
  'Gavin', 'Hana', 'Iris', 'Ishaan', 'Jasper', 'Jia', 'Kavi', 'Keiko', 'Lena', 'Liam', 'Maya', 'Mina', 'Nadia', 'Nikhil', 'Noah',
  'Owen', 'Priya', 'Quinn', 'Rafael', 'Riya', 'Sana', 'Sofia', 'Tara', 'Theo', 'Uma', 'Vikram', 'Willow', 'Yuki', 'Zara', 'Zion',
];

const LAST_NAMES = [
  'Agarwal', 'Bennett', 'Chen', 'Das', 'Edwards', 'Fernandez', 'Gupta', 'Hassan', 'Iyer', 'Jensen', 'Kapoor', 'Lee', 'Mehta',
  'Nakamura', 'Ortiz', 'Patel', 'Quintero', 'Rao', 'Singh', 'Tan', 'Usman', 'Vasquez', 'Wong', 'Xu', 'Yamada', 'Zimmerman',
  'Bose', 'Chakraborty', 'Dawson', 'Farouk', 'Ghosh', 'Hernandez', 'Inoue', 'Johnson', 'Khan', 'Lopez', 'Morrison', 'Nair',
  'Okafor', 'Perera', 'Raman', 'Sharma', 'Taylor', 'Valdez', 'Walker', 'Young', 'Zhang',
];

const COMPANY_NAMES = [
  'Aurora Systems',
  'Nimbus Grid',
  'Atlas Loop',
  'Pioneer Labs',
  'Vector Forge',
  'Signal Harbor',
  'Northstar Core',
  'Mergepoint',
  'Cloudline',
  'Sentry Path',
  'Helix Works',
  'Cobalt River',
  'Vertex Station',
  'Open Meridian',
  'Frameflow',
];

function seededRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function randomInt(min: number, max: number, seed: number): number {
  return Math.floor(seededRandom(seed) * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, seed: number, precision = 2): number {
  const value = min + seededRandom(seed) * (max - min);
  return Number(value.toFixed(precision));
}

function deterministicShuffle<T>(items: T[]): T[] {
  const output = [...items];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(seededRandom(index + 99) * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }

  return output;
}

function clampScore(value: number): number {
  return Math.max(40, Math.min(99, Math.round(value)));
}

function buildStageSequence(): CandidateStage[] {
  const expanded: CandidateStage[] = [];

  for (const entry of STAGE_TARGETS) {
    for (let count = 0; count < entry.count; count += 1) {
      expanded.push(entry.stage);
    }
  }

  if (expanded.length !== TARGET_CANDIDATE_COUNT) {
    throw new Error(`Stage target mismatch: expected ${TARGET_CANDIDATE_COUNT}, got ${expanded.length}.`);
  }

  return deterministicShuffle(expanded);
}

function buildSourceReceivedAt(stage: CandidateStage, globalIndex: number): Date {
  const hourOffset = randomInt(0, 18, globalIndex + 401);

  if (stage === 'interview_scheduled') {
    const daysAgo = randomInt(7, 10, globalIndex + 77);
    return new Date(NOW.getTime() - daysAgo * DAY_MS - hourOffset * 60 * 60 * 1000);
  }

  if (stage === 'interviewed' || stage === 'offer_sent' || stage === 'hired') {
    const daysAgo = randomInt(18, 27, globalIndex + 123);
    return new Date(NOW.getTime() - daysAgo * DAY_MS - hourOffset * 60 * 60 * 1000);
  }

  if (stage === 'reviewed') {
    const daysAgo = randomInt(4, 12, globalIndex + 201);
    return new Date(NOW.getTime() - daysAgo * DAY_MS - hourOffset * 60 * 60 * 1000);
  }

  if (stage === 'rejected') {
    const daysAgo = randomInt(10, 18, globalIndex + 305);
    return new Date(NOW.getTime() - daysAgo * DAY_MS - hourOffset * 60 * 60 * 1000);
  }

  const daysAgo = randomInt(1, 5, globalIndex + 509);
  return new Date(NOW.getTime() - daysAgo * DAY_MS - hourOffset * 60 * 60 * 1000);
}

function scoreForStage(stage: CandidateStage, seed: number): number | null {
  if (stage === 'applied') {
    return null;
  }

  const baselineByStage: Record<Exclude<CandidateStage, 'applied'>, number> = {
    reviewed: 76,
    interview_scheduled: 82,
    interviewed: 86,
    offer_sent: 90,
    hired: 94,
    rejected: 61,
  };

  const spreadByStage: Record<Exclude<CandidateStage, 'applied'>, number> = {
    reviewed: 9,
    interview_scheduled: 8,
    interviewed: 7,
    offer_sent: 6,
    hired: 4,
    rejected: 11,
  };

  const baseline = baselineByStage[stage];
  const spread = spreadByStage[stage];
  return clampScore(baseline + randomInt(-spread, spread, seed));
}

function confidenceForStage(stage: CandidateStage, score: number | null, seed: number): number | null {
  if (score === null) {
    return null;
  }

  const adjustment = stage === 'rejected' ? randomInt(2, 10, seed) : randomInt(4, 9, seed);
  return clampScore(score + adjustment);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function buildCandidateSummary(stage: CandidateStage, score: number | null, confidence: number | null, title: string): string {
  const scoreLabel = score === null ? 'pending score' : `score ${score}`;
  const confidenceLabel = confidence === null ? 'confidence pending' : `confidence ${confidence}%`;

  if (stage === 'applied') {
    return `New ${title} applicant queued for analyst review (${scoreLabel}, ${confidenceLabel}).`;
  }

  if (stage === 'reviewed') {
    return `${title} profile reviewed with ${scoreLabel}; awaiting recruiter follow-up.`;
  }

  if (stage === 'interview_scheduled') {
    return `Interview scheduled for ${title} candidate with ${scoreLabel} and ${confidenceLabel}.`;
  }

  if (stage === 'interviewed') {
    return `Interview loop completed for ${title}; ready for final calibration (${scoreLabel}).`;
  }

  if (stage === 'offer_sent') {
    return `Offer workflow in progress for ${title} candidate (${scoreLabel}, ${confidenceLabel}).`;
  }

  if (stage === 'hired') {
    return `${title} candidate accepted offer and is in onboarding transition.`;
  }

  return `${title} candidate rejected after review loop due to role fit and signal mismatch.`;
}

function buildTemplateForJob(job: JobBlueprint) {
  return {
    id: `tmpl_offer_${job.id}`,
    organizationId: DEMO_ORGANIZATION.id,
    type: 'offer_letter' as const,
    name: `${job.title} Offer Letter`,
    subject: `Offer Letter: {{candidateName}} · ${job.title} · Headhunt Demo Labs`,
    body: [
      'Hi {{candidateName}},',
      '',
      `We are excited to extend an offer for ${job.title} on our ${job.department} team.`,
      '',
      'Compensation package:',
      '- Base salary: {{baseSalary}} {{currency}}',
      '- Equity: {{equityPercent}}%',
      '- Start date: {{startDate}}',
      '- Bonus target: {{bonusTargetPercent}}%',
      '',
      'Role highlights:',
      ...job.responsibilities.map((item) => `- ${item}`),
      '',
      'Please reply with your acceptance and any clarifying questions.',
      '',
      'Best,',
      '{{senderName}}',
      'Headhunt Demo Labs',
    ].join('\n'),
    variables: ['candidateName', 'baseSalary', 'currency', 'equityPercent', 'startDate', 'bonusTargetPercent', 'senderName'],
  };
}

const stageSequence = buildStageSequence();

const demoJobs = JOB_BLUEPRINTS.map((job) => {
  const jdTemplate: JdTemplate = normalizeJdTemplate({
    title: job.title,
    department: job.department,
    employmentType: job.employmentType,
    location: job.location,
    compensation: job.compensation,
    roleSummary: job.roleSummary,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    preferredQualifications: job.preferredQualifications,
    benefits: job.benefits,
    hiringSignals: job.hiringSignals,
  });

  return {
    id: job.id,
    organizationId: DEMO_ORGANIZATION.id,
    title: job.title,
    status: 'active' as const,
    jdTemplate,
  };
});

const demoTemplates = [
  {
    id: 'tmpl_demo_interview_invitation',
    organizationId: DEMO_ORGANIZATION.id,
    type: 'interview_invitation' as const,
    name: 'Interview Invitation · Standard',
    subject: 'Interview Invitation: {{jobTitle}} at Headhunt Demo Labs',
    body: [
      'Hi {{candidateName}},',
      '',
      'Thanks again for your application. We would like to schedule your next interview for {{jobTitle}}.',
      'Suggested duration: {{durationMinutes}} minutes.',
      'Please reply with a preferred slot from the options in this thread.',
      '',
      'Best,',
      '{{senderName}}',
    ].join('\n'),
    variables: ['candidateName', 'jobTitle', 'durationMinutes', 'senderName'],
  },
  {
    id: 'tmpl_demo_rejection',
    organizationId: DEMO_ORGANIZATION.id,
    type: 'rejection' as const,
    name: 'Rejection · Professional',
    subject: 'Update on your {{jobTitle}} application',
    body: [
      'Hi {{candidateName}},',
      '',
      'Thank you for your interest and time spent with our team.',
      'After careful review, we have decided to move forward with other candidates for {{jobTitle}}.',
      'We appreciate your effort and encourage you to apply again in the future.',
      '',
      'Regards,',
      '{{senderName}}',
    ].join('\n'),
    variables: ['candidateName', 'jobTitle', 'senderName'],
  },
  {
    id: 'tmpl_demo_follow_up',
    organizationId: DEMO_ORGANIZATION.id,
    type: 'follow_up' as const,
    name: 'Follow-up · Candidate Nudge',
    subject: 'Quick follow-up on your {{jobTitle}} interview',
    body: [
      'Hi {{candidateName}},',
      '',
      'Following up on your recent interview for {{jobTitle}}.',
      'Please share your availability for next steps if you are still interested.',
      '',
      'Thanks,',
      '{{senderName}}',
    ].join('\n'),
    variables: ['candidateName', 'jobTitle', 'senderName'],
  },
  ...JOB_BLUEPRINTS.map((job) => buildTemplateForJob(job)),
];

const demoCandidates: Array<{
  id: string;
  organizationId: string;
  jobId: string;
  name: string;
  contactEmail: string;
  stage: CandidateStage;
  score: number | null;
  intelConfidence: number | null;
  scoreBreakdown: Array<{ dimension: string; score: number; reasoning: string }>;
  qualificationChecks: Array<{ requirement: string; met: boolean; evidence: string }>;
  workHistory: Array<{ company: string; role: string; period: string }>;
  summary: string;
  sourceEmailMessageId: string;
  sourceEmailThreadId: string;
  sourceEmailReceivedAt: Date;
}> = [];

const demoApplications: Array<{
  id: string;
  candidateId: string;
  jobId: string;
  stage: CandidateStage;
  status: ApplicationStatus;
}> = [];

const demoInterviews: Array<{
  id: string;
  organizationId: string;
  candidateId: string;
  jobId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: InterviewStatus;
  googleCalendarEventId: string;
  googleMeetLink: string | null;
  summary: string;
  slackMessageTs: string;
}> = [];

const demoOffers: Array<{
  id: string;
  organizationId: string;
  candidateId: string;
  jobId: string;
  status: OfferStatus;
  draftContent: string;
  terms: Record<string, unknown>;
  initiatedBy: string;
  cibaAuthReqId: string | null;
  cibaApprovedBy: string | null;
  sentAt: Date | null;
  candidateResponse: 'accepted' | 'declined' | null;
}> = [];

const demoAuditLogs: Array<{
  id: string;
  organizationId: string;
  actorType: 'agent' | 'user' | 'system';
  actorId: string;
  actorDisplayName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  result: 'success' | 'pending' | 'denied' | 'error';
  timestamp: Date;
}> = [];

if (JOB_CANDIDATE_COUNTS.length !== JOB_BLUEPRINTS.length) {
  throw new Error('JOB_CANDIDATE_COUNTS must match JOB_BLUEPRINTS length.');
}

const candidateCountFromPlan = JOB_CANDIDATE_COUNTS.reduce((sum, count) => sum + count, 0);
if (candidateCountFromPlan !== TARGET_CANDIDATE_COUNT) {
  throw new Error(`Candidate plan mismatch: expected ${TARGET_CANDIDATE_COUNT}, got ${candidateCountFromPlan}.`);
}

logStep(
  `Preparing dataset: ${TARGET_CANDIDATE_COUNT} candidates across ${JOB_BLUEPRINTS.length} jobs (chunk size ${CHUNK_SIZE}).`,
);

let globalCandidateIndex = 0;
let interviewCounter = 1;
let offerCounter = 1;

for (let jobIndex = 0; jobIndex < JOB_BLUEPRINTS.length; jobIndex += 1) {
  const job = JOB_BLUEPRINTS[jobIndex];
  const countForJob = JOB_CANDIDATE_COUNTS[jobIndex];

  for (let localIndex = 0; localIndex < countForJob; localIndex += 1) {
    const stage = stageSequence[globalCandidateIndex];
    const candidateId = `cand_demo_${String(globalCandidateIndex + 1).padStart(3, '0')}`;
    const firstName = FIRST_NAMES[globalCandidateIndex % FIRST_NAMES.length];
    const lastName = LAST_NAMES[Math.floor(globalCandidateIndex / FIRST_NAMES.length) % LAST_NAMES.length];
    const name = `${firstName} ${lastName}`;
    const emailLocal = `${slugify(firstName)}.${slugify(lastName)}.${String(globalCandidateIndex + 1).padStart(3, '0')}`;
    const contactEmail = `${emailLocal}@demo-candidates.example.com`;

    const score = scoreForStage(stage, globalCandidateIndex + 700);
    const intelConfidence = confidenceForStage(stage, score, globalCandidateIndex + 903);

    const scoreBreakdown =
      score === null
        ? []
        : job.scoringDimensions.map((dimension, dimensionIndex) => {
            const dimensionScore = clampScore(score + randomInt(-6, 6, globalCandidateIndex * 17 + dimensionIndex));
            return {
              dimension,
              score: dimensionScore,
              reasoning: `${dimension} signal calibrated from resume depth, interview artifacts, and role-specific checks.`,
            };
          });

    const qualificationChecks = job.requirements.slice(0, 3).map((requirement, requirementIndex) => {
      const thresholdByStage: Record<CandidateStage, number> = {
        applied: 0.85,
        reviewed: 0.55,
        interview_scheduled: 0.42,
        interviewed: 0.3,
        offer_sent: 0.2,
        hired: 0.1,
        rejected: 0.75,
      };

      const randomValue = seededRandom(globalCandidateIndex * 13 + requirementIndex + 11);
      const met = randomValue > thresholdByStage[stage];

      return {
        requirement,
        met,
        evidence: met
          ? 'Evidence found in portfolio, work history, and interview narratives.'
          : 'Requirement not fully demonstrated in submitted application materials.',
      };
    });

    const companyA = COMPANY_NAMES[(globalCandidateIndex + jobIndex) % COMPANY_NAMES.length];
    const companyB = COMPANY_NAMES[(globalCandidateIndex + jobIndex + 5) % COMPANY_NAMES.length];

    const workHistory = [
      {
        company: companyA,
        role: `${job.title} (${job.department})`,
        period: `${2019 + (globalCandidateIndex % 3)}-${2022 + (globalCandidateIndex % 4)}`,
      },
      {
        company: companyB,
        role: `${job.department} Specialist`,
        period: `${2016 + (globalCandidateIndex % 4)}-${2019 + (globalCandidateIndex % 3)}`,
      },
    ];

    const sourceEmailReceivedAt = buildSourceReceivedAt(stage, globalCandidateIndex);

    demoCandidates.push({
      id: candidateId,
      organizationId: DEMO_ORGANIZATION.id,
      jobId: job.id,
      name,
      contactEmail,
      stage,
      score,
      intelConfidence,
      scoreBreakdown,
      qualificationChecks,
      workHistory,
      summary: buildCandidateSummary(stage, score, intelConfidence, job.title),
      sourceEmailMessageId: `msg_demo_${String(globalCandidateIndex + 1).padStart(4, '0')}`,
      sourceEmailThreadId: `thread_demo_${String(globalCandidateIndex + 1).padStart(4, '0')}`,
      sourceEmailReceivedAt,
    });

    const applicationStatus: ApplicationStatus = stage === 'hired' || stage === 'rejected' ? 'archived' : 'active';

    demoApplications.push({
      id: `app_${candidateId}`,
      candidateId,
      jobId: job.id,
      stage,
      status: applicationStatus,
    });

    const firstInterviewAt = new Date(sourceEmailReceivedAt.getTime() + (8 + (globalCandidateIndex % 5)) * DAY_MS);

    const addInterview = (round: number, status: InterviewStatus, scheduledAt: Date) => {
      const interviewId = `int_demo_${String(interviewCounter).padStart(4, '0')}`;
      interviewCounter += 1;

      demoInterviews.push({
        id: interviewId,
        organizationId: DEMO_ORGANIZATION.id,
        candidateId,
        jobId: job.id,
        scheduledAt,
        durationMinutes: 45 + (round % 2) * 15,
        status,
        // Use Cal-managed event IDs to align with production scheduling flow.
        googleCalendarEventId: `cal:${interviewId}`,
        googleMeetLink: `https://cal.com/headhunt-demo/interview/${interviewId}`,
        summary:
          status === 'scheduled'
            ? `Round ${round} interview scheduled via Cal.com for ${name}.`
            : `Round ${round} interview completed for ${name}.`,
        slackMessageTs: `${1712000000 + interviewCounter}.${String(100000 + round).slice(-6)}`,
      });
    };

    if (stage === 'interview_scheduled') {
      addInterview(1, 'scheduled', firstInterviewAt);
    } else if (stage === 'interviewed') {
      addInterview(1, 'completed', firstInterviewAt);
      addInterview(2, 'completed', new Date(firstInterviewAt.getTime() + 3 * DAY_MS));
    } else if (stage === 'offer_sent') {
      addInterview(1, 'completed', firstInterviewAt);
      addInterview(2, 'completed', new Date(firstInterviewAt.getTime() + 4 * DAY_MS));
    } else if (stage === 'hired') {
      addInterview(1, 'completed', firstInterviewAt);
      addInterview(2, 'completed', new Date(firstInterviewAt.getTime() + 3 * DAY_MS));
      addInterview(3, 'completed', new Date(firstInterviewAt.getTime() + 6 * DAY_MS));
    } else if (stage === 'rejected' && globalCandidateIndex % 2 === 0) {
      addInterview(1, 'completed', firstInterviewAt);
    }

    if (stage === 'offer_sent' || stage === 'hired') {
      const salary = randomInt(job.salaryRange[0], job.salaryRange[1], globalCandidateIndex + 1111);
      const equity = randomFloat(job.equityRange[0], job.equityRange[1], globalCandidateIndex + 1212, 2);
      const bonusTargetPercent = randomInt(10, 20, globalCandidateIndex + 1313);
      const startDate = new Date(firstInterviewAt.getTime() + (14 + (globalCandidateIndex % 21)) * DAY_MS);

      let offerStatus: OfferStatus;
      let cibaAuthReqId: string | null = null;
      let cibaApprovedBy: string | null = null;
      let sentAt: Date | null = null;
      let candidateResponse: 'accepted' | 'declined' | null = null;

      if (stage === 'hired') {
        offerStatus = 'accepted';
        sentAt = new Date(firstInterviewAt.getTime() + 8 * DAY_MS);
        cibaApprovedBy = 'auth0|founder_alice';
        candidateResponse = 'accepted';
      } else {
        const mode = globalCandidateIndex % 10;
        if (mode <= 3) {
          offerStatus = 'awaiting_approval';
          cibaAuthReqId = `ciba_demo_${String(globalCandidateIndex + 1).padStart(4, '0')}`;
        } else if (mode <= 5) {
          offerStatus = 'approved';
          cibaAuthReqId = `ciba_demo_${String(globalCandidateIndex + 1).padStart(4, '0')}`;
          cibaApprovedBy = 'auth0|founder_alice';
        } else {
          offerStatus = 'sent';
          sentAt = new Date(firstInterviewAt.getTime() + 7 * DAY_MS);
        }
      }

      const offerId = `offer_demo_${String(offerCounter).padStart(4, '0')}`;
      offerCounter += 1;

      demoOffers.push({
        id: offerId,
        organizationId: DEMO_ORGANIZATION.id,
        candidateId,
        jobId: job.id,
        status: offerStatus,
        draftContent: [
          `Dear ${name},`,
          '',
          `We are pleased to offer you the ${job.title} role at Headhunt Demo Labs.`,
          `Base salary: $${salary.toLocaleString('en-US')} USD`,
          `Equity grant: ${equity}%`,
          `Target bonus: ${bonusTargetPercent}%`,
          `Start date: ${startDate.toISOString().slice(0, 10)}`,
          '',
          'Please review the enclosed terms and reply with your acceptance.',
        ].join('\n'),
        terms: {
          baseSalary: salary,
          currency: 'USD',
          startDate: startDate.toISOString().slice(0, 10),
          equityPercent: equity,
          bonusTargetPercent,
          signOnBonus: randomInt(5000, 25000, globalCandidateIndex + 1414),
          notes: `Offer calibrated for ${job.title} band and interview signal profile.`,
          additional: {
            locationPolicy: job.location,
            department: job.department,
          },
        },
        initiatedBy: globalCandidateIndex % 2 === 0 ? 'auth0|founder_alice' : 'auth0|manager_bob',
        cibaAuthReqId,
        cibaApprovedBy,
        sentAt,
        candidateResponse,
      });
    }

    globalCandidateIndex += 1;
  }
}

logStep(
  `Generated rows: jobs=${demoJobs.length}, candidates=${demoCandidates.length}, applications=${demoApplications.length}, interviews=${demoInterviews.length}, offers=${demoOffers.length}.`,
);

let auditCounter = 1;
const nextAuditId = () => `audit_demo_${String(auditCounter++).padStart(5, '0')}`;

for (const candidate of demoCandidates.slice(0, 150)) {
  demoAuditLogs.push({
    id: nextAuditId(),
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'user',
    actorId: 'auth0|founder_alice',
    actorDisplayName: 'Alice Founder',
    action: 'candidate.ingest.created',
    resourceType: 'candidate',
    resourceId: candidate.id,
    metadata: {
      jobId: candidate.jobId,
      sourceMessageId: candidate.sourceEmailMessageId,
      stage: candidate.stage,
    },
    result: 'success',
    timestamp: new Date(candidate.sourceEmailReceivedAt.getTime() + 2 * 60 * 1000),
  });
}

for (const candidate of demoCandidates.filter((item) => item.score !== null).slice(0, 140)) {
  demoAuditLogs.push({
    id: nextAuditId(),
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent',
    actorId: 'generate_intel_card',
    actorDisplayName: 'Analyst Agent',
    action: 'candidate.intel.generated',
    resourceType: 'candidate',
    resourceId: candidate.id,
    metadata: {
      jobId: candidate.jobId,
      score: candidate.score,
      confidence: candidate.intelConfidence,
    },
    result: 'success',
    timestamp: new Date(candidate.sourceEmailReceivedAt.getTime() + 30 * 60 * 1000),
  });
}

for (const interview of demoInterviews.slice(0, 180)) {
  demoAuditLogs.push({
    id: nextAuditId(),
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent',
    actorId: 'liaison',
    actorDisplayName: 'Liaison Agent',
    action: interview.status === 'scheduled' ? 'interview.scheduled' : 'interview.completed',
    resourceType: 'interview',
    resourceId: interview.id,
    metadata: {
      candidateId: interview.candidateId,
      jobId: interview.jobId,
      eventId: interview.googleCalendarEventId,
      status: interview.status,
    },
    result: 'success',
    timestamp: new Date(interview.scheduledAt.getTime() - 10 * 60 * 1000),
  });
}

for (const offer of demoOffers) {
  const result: 'success' | 'pending' | 'denied' | 'error' =
    offer.status === 'awaiting_approval' ? 'pending' : offer.status === 'withdrawn' ? 'denied' : 'success';

  demoAuditLogs.push({
    id: nextAuditId(),
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent',
    actorId: 'dispatch',
    actorDisplayName: 'Dispatch Agent',
    action: `offer.${offer.status}`,
    resourceType: 'offer',
    resourceId: offer.id,
    metadata: {
      candidateId: offer.candidateId,
      jobId: offer.jobId,
      initiatedBy: offer.initiatedBy,
      cibaAuthReqId: offer.cibaAuthReqId,
    },
    result,
    timestamp: offer.sentAt ?? NOW,
  });
}

const stageCountsFromSeed = demoCandidates.reduce<Record<CandidateStage, number>>(
  (counts, candidate) => {
    counts[candidate.stage] += 1;
    return counts;
  },
  {
    applied: 0,
    reviewed: 0,
    interview_scheduled: 0,
    interviewed: 0,
    offer_sent: 0,
    hired: 0,
    rejected: 0,
  },
);

const offerStatusCountsFromSeed = demoOffers.reduce<Record<OfferStatus, number>>(
  (counts, offer) => {
    counts[offer.status] += 1;
    return counts;
  },
  {
    draft: 0,
    awaiting_approval: 0,
    approved: 0,
    sent: 0,
    accepted: 0,
    declined: 0,
    withdrawn: 0,
  },
);

const firstInterviewByCandidate = new Map<string, Date>();
for (const interview of demoInterviews) {
  const existing = firstInterviewByCandidate.get(interview.candidateId);
  if (!existing || interview.scheduledAt.getTime() < existing.getTime()) {
    firstInterviewByCandidate.set(interview.candidateId, interview.scheduledAt);
  }
}

const daysToFirstInterview = demoCandidates
  .map((candidate) => {
    const firstInterview = firstInterviewByCandidate.get(candidate.id);
    if (!firstInterview) {
      return null;
    }

    return Math.round((firstInterview.getTime() - candidate.sourceEmailReceivedAt.getTime()) / DAY_MS);
  })
  .filter((value): value is number => value !== null);

const averageDaysToFirstInterview =
  daysToFirstInterview.length > 0
    ? Number((daysToFirstInterview.reduce((sum, days) => sum + days, 0) / daysToFirstInterview.length).toFixed(2))
    : 0;

const frontendSnapshotPayload = {
  source: 'scripts/seed-demo-headhunt.ts',
  generatedAt: NOW.toISOString(),
  organizationId: DEMO_ORGANIZATION.id,
  summary: {
    jobs: demoJobs.length,
    candidates: demoCandidates.length,
    applications: demoApplications.length,
    interviews: demoInterviews.length,
    offers: demoOffers.length,
    templates: demoTemplates.length,
    auditLogs: demoAuditLogs.length,
    averageDaysToFirstInterview,
  },
  stageCounts: stageCountsFromSeed,
  offerStatusCounts: offerStatusCountsFromSeed,
  notes: {
    nonProductManagerJobs: true,
    datasetIntent: 'Rich recruiting demo with coherent relations across jobs, candidates, pipeline, interviews, and offers.',
  },
};

const FRONTEND_MOCK_SNAPSHOT = {
  id: 'frontend_mock_dashboard_seed',
  slug: 'dashboard_api_mock',
  version: `2026-04-06-rich-${TARGET_CANDIDATE_COUNT}`,
  organizationId: DEMO_ORGANIZATION.id,
  payload: frontendSnapshotPayload,
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not defined. Set it in .env.local before running seed:demo.');
  }

  const connection = postgres(databaseUrl);
  const db = drizzle(connection);

  const demoJobIds = demoJobs.map((job) => job.id);
  const writeChunks = async <T>(
    label: string,
    rows: T[],
    writer: (chunk: T[]) => Promise<void>,
  ) => {
    if (rows.length === 0) {
      logStep(`${label}: nothing to write.`);
      return;
    }

    const chunks = chunkRows(rows, CHUNK_SIZE);
    logStep(`${label}: ${rows.length} rows in ${chunks.length} chunks.`);

    let processed = 0;
    for (const chunk of chunks) {
      await writer(chunk);
      processed += chunk.length;
      logStep(`${label}: ${processed}/${rows.length}`);
    }
  };

  try {
    logStep(`Starting ${shouldReset ? 'reset-and-seed' : 'upsert-seed'} transaction...`);
    const result = await db.transaction(async (tx) => {
      if (shouldReset) {
        logStep('Reset requested: deleting previous demo records...');
        await tx.delete(frontendMockSnapshots).where(eq(frontendMockSnapshots.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(offers).where(eq(offers.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(interviews).where(eq(interviews.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(applications).where(inArray(applications.jobId, demoJobIds));
        await tx.delete(auditLogs).where(eq(auditLogs.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(candidates).where(eq(candidates.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(templates).where(eq(templates.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(jobs).where(eq(jobs.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(organizations).where(eq(organizations.id, DEMO_ORGANIZATION.id));
        logStep('Reset completed.');
      }

      logStep('Upserting organization...');
      await tx
        .insert(organizations)
        .values(DEMO_ORGANIZATION)
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name: DEMO_ORGANIZATION.name,
            updatedAt: new Date(),
          },
        });

      logStep('Upserting frontend snapshot metadata...');
      await tx
        .insert(frontendMockSnapshots)
        .values({
          id: FRONTEND_MOCK_SNAPSHOT.id,
          slug: FRONTEND_MOCK_SNAPSHOT.slug,
          version: FRONTEND_MOCK_SNAPSHOT.version,
          organizationId: FRONTEND_MOCK_SNAPSHOT.organizationId,
          payload: FRONTEND_MOCK_SNAPSHOT.payload,
          seededAt: new Date(),
        })
        .onConflictDoUpdate({
          target: frontendMockSnapshots.id,
          set: {
            slug: FRONTEND_MOCK_SNAPSHOT.slug,
            version: FRONTEND_MOCK_SNAPSHOT.version,
            organizationId: FRONTEND_MOCK_SNAPSHOT.organizationId,
            payload: FRONTEND_MOCK_SNAPSHOT.payload,
            seededAt: new Date(),
            updatedAt: new Date(),
          },
        });

      await writeChunks('jobs', demoJobs, async (chunk) => {
        if (shouldReset) {
          await tx.insert(jobs).values(chunk);
          return;
        }

        await tx.insert(jobs).values(chunk).onConflictDoUpdate({
          target: jobs.id,
          set: {
            organizationId: sql`excluded.organization_id`,
            title: sql`excluded.title`,
            status: sql`excluded.status`,
            jdTemplate: sql`excluded.jd_template`,
            updatedAt: sql`now()`,
          },
        });
      });

      await writeChunks('templates', demoTemplates, async (chunk) => {
        if (shouldReset) {
          await tx.insert(templates).values(chunk);
          return;
        }

        await tx.insert(templates).values(chunk).onConflictDoUpdate({
          target: templates.id,
          set: {
            organizationId: sql`excluded.organization_id`,
            type: sql`excluded.type`,
            name: sql`excluded.name`,
            subject: sql`excluded.subject`,
            body: sql`excluded.body`,
            variables: sql`excluded.variables`,
            updatedAt: sql`now()`,
          },
        });
      });

      await writeChunks('candidates', demoCandidates, async (chunk) => {
        if (shouldReset) {
          await tx.insert(candidates).values(chunk);
          return;
        }

        await tx.insert(candidates).values(chunk).onConflictDoUpdate({
          target: candidates.id,
          set: {
            organizationId: sql`excluded.organization_id`,
            jobId: sql`excluded.job_id`,
            name: sql`excluded.name`,
            contactEmail: sql`excluded.contact_email`,
            stage: sql`excluded.stage`,
            score: sql`excluded.score`,
            intelConfidence: sql`excluded.intel_confidence`,
            scoreBreakdown: sql`excluded.score_breakdown`,
            qualificationChecks: sql`excluded.qualification_checks`,
            workHistory: sql`excluded.work_history`,
            summary: sql`excluded.summary`,
            sourceEmailMessageId: sql`excluded.source_email_message_id`,
            sourceEmailThreadId: sql`excluded.source_email_thread_id`,
            sourceEmailReceivedAt: sql`excluded.source_email_received_at`,
            updatedAt: sql`now()`,
          },
        });
      });

      await writeChunks('applications', demoApplications, async (chunk) => {
        if (shouldReset) {
          await tx.insert(applications).values(chunk);
          return;
        }

        await tx.insert(applications).values(chunk).onConflictDoUpdate({
          target: applications.id,
          set: {
            candidateId: sql`excluded.candidate_id`,
            jobId: sql`excluded.job_id`,
            stage: sql`excluded.stage`,
            status: sql`excluded.status`,
            updatedAt: sql`now()`,
          },
        });
      });

      await writeChunks('interviews', demoInterviews, async (chunk) => {
        if (shouldReset) {
          await tx.insert(interviews).values(chunk);
          return;
        }

        await tx.insert(interviews).values(chunk).onConflictDoUpdate({
          target: interviews.id,
          set: {
            organizationId: sql`excluded.organization_id`,
            candidateId: sql`excluded.candidate_id`,
            jobId: sql`excluded.job_id`,
            scheduledAt: sql`excluded.scheduled_at`,
            durationMinutes: sql`excluded.duration_minutes`,
            status: sql`excluded.status`,
            googleCalendarEventId: sql`excluded.google_calendar_event_id`,
            googleMeetLink: sql`excluded.google_meet_link`,
            summary: sql`excluded.summary`,
            slackMessageTs: sql`excluded.slack_message_ts`,
            updatedAt: sql`now()`,
          },
        });
      });

      await writeChunks('offers', demoOffers, async (chunk) => {
        if (shouldReset) {
          await tx.insert(offers).values(chunk);
          return;
        }

        await tx.insert(offers).values(chunk).onConflictDoUpdate({
          target: offers.id,
          set: {
            organizationId: sql`excluded.organization_id`,
            candidateId: sql`excluded.candidate_id`,
            jobId: sql`excluded.job_id`,
            status: sql`excluded.status`,
            draftContent: sql`excluded.draft_content`,
            terms: sql`excluded.terms`,
            initiatedBy: sql`excluded.initiated_by`,
            cibaAuthReqId: sql`excluded.ciba_auth_req_id`,
            cibaApprovedBy: sql`excluded.ciba_approved_by`,
            sentAt: sql`excluded.sent_at`,
            candidateResponse: sql`excluded.candidate_response`,
            updatedAt: sql`now()`,
          },
        });
      });

      await writeChunks('audit_logs', demoAuditLogs, async (chunk) => {
        if (shouldReset) {
          await tx.insert(auditLogs).values(chunk);
          return;
        }

        await tx.insert(auditLogs).values(chunk).onConflictDoUpdate({
          target: auditLogs.id,
          set: {
            organizationId: sql`excluded.organization_id`,
            actorType: sql`excluded.actor_type`,
            actorId: sql`excluded.actor_id`,
            actorDisplayName: sql`excluded.actor_display_name`,
            action: sql`excluded.action`,
            resourceType: sql`excluded.resource_type`,
            resourceId: sql`excluded.resource_id`,
            metadata: sql`excluded.metadata`,
            result: sql`excluded.result`,
            timestamp: sql`excluded.timestamp`,
          },
        });
      });

      const stageCounts = await tx
        .select({
          stage: candidates.stage,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(eq(candidates.organizationId, DEMO_ORGANIZATION.id))
        .groupBy(candidates.stage)
        .orderBy(candidates.stage);

      const offerStatusCounts = await tx
        .select({
          status: offers.status,
          count: sql<number>`count(*)::int`,
        })
        .from(offers)
        .where(eq(offers.organizationId, DEMO_ORGANIZATION.id))
        .groupBy(offers.status)
        .orderBy(offers.status);

      return {
        organizationId: DEMO_ORGANIZATION.id,
        jobs: demoJobs.length,
        candidates: demoCandidates.length,
        interviews: demoInterviews.length,
        offers: demoOffers.length,
        templates: demoTemplates.length,
        auditLogs: demoAuditLogs.length,
        frontendMockSnapshot: {
          id: FRONTEND_MOCK_SNAPSHOT.id,
          slug: FRONTEND_MOCK_SNAPSHOT.slug,
          version: FRONTEND_MOCK_SNAPSHOT.version,
        },
        stageCounts,
        offerStatusCounts,
        averageDaysToFirstInterview,
      };
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: shouldReset ? 'reset-and-seed' : 'upsert-seed',
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Demo seed failed.');
  console.error(error);
  process.exit(1);
});
