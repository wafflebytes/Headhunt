import dotenv from 'dotenv';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { offers } from '@/lib/db/schema/offers';
import { organizations } from '@/lib/db/schema/organizations';
import { templates } from '@/lib/db/schema/templates';

dotenv.config({ path: '.env.local' });
dotenv.config();

const shouldReset = process.argv.includes('--reset');

const DEMO_ORGANIZATION = {
  id: 'org_demo_headhunt',
  name: 'Headhunt Demo Labs',
};

const DEMO_JOBS = [
  {
    id: 'job_demo_founding_engineer',
    organizationId: DEMO_ORGANIZATION.id,
    title: 'Founding Engineer',
    status: 'active' as const,
  },
  {
    id: 'job_demo_product_designer',
    organizationId: DEMO_ORGANIZATION.id,
    title: 'Product Designer',
    status: 'active' as const,
  },
];

const DEMO_TEMPLATES = [
  {
    id: 'tmpl_demo_interview_invite',
    organizationId: DEMO_ORGANIZATION.id,
    type: 'interview_invitation' as const,
    name: 'Demo Interview Invitation',
    subject: 'Interview Opportunity: {{jobTitle}} at {{companyName}}',
    body: [
      'Hi {{candidateName}},',
      '',
      'Thanks for your application for the {{jobTitle}} role.',
      'Would you be open to a {{durationMinutes}}-minute interview this week?',
      '',
      'Best,',
      '{{senderName}}',
    ].join('\n'),
    variables: ['candidateName', 'jobTitle', 'companyName', 'durationMinutes', 'senderName'],
  },
  {
    id: 'tmpl_demo_offer_letter',
    organizationId: DEMO_ORGANIZATION.id,
    type: 'offer_letter' as const,
    name: 'Demo Offer Letter',
    subject: 'Offer Letter: {{jobTitle}} at {{companyName}}',
    body: [
      'Hi {{candidateName}},',
      '',
      'We are excited to extend an offer for {{jobTitle}} at {{companyName}}.',
      'Base salary: {{baseSalary}}',
      'Start date: {{startDate}}',
      '',
      'Please reply to accept this offer.',
    ].join('\n'),
    variables: ['candidateName', 'jobTitle', 'companyName', 'baseSalary', 'startDate'],
  },
  {
    id: 'tmpl_demo_rejection',
    organizationId: DEMO_ORGANIZATION.id,
    type: 'rejection' as const,
    name: 'Demo Rejection',
    subject: 'Update on your {{jobTitle}} application',
    body: [
      'Hi {{candidateName}},',
      '',
      'Thank you for your time. We decided to move forward with other candidates at this time.',
      '',
      'We appreciate your interest in {{companyName}}.',
    ].join('\n'),
    variables: ['candidateName', 'jobTitle', 'companyName'],
  },
];

const DEMO_CANDIDATES = [
  {
    id: 'cand_demo_maya',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_founding_engineer',
    name: 'Maya Patel',
    contactEmail: 'maya.patel.demo+apply@example.com',
    stage: 'applied' as const,
    score: null,
    intelConfidence: null,
    scoreBreakdown: [],
    qualificationChecks: [],
    workHistory: [],
    summary: 'Fresh inbound applicant awaiting analyst scoring.',
    sourceEmailMessageId: 'msg_demo_apply_001',
    sourceEmailThreadId: 'thread_demo_apply_001',
    sourceEmailReceivedAt: new Date('2026-04-02T08:05:00.000Z'),
  },
  {
    id: 'cand_demo_aditya',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_founding_engineer',
    name: 'Aditya Rao',
    contactEmail: 'aditya.rao.demo+reviewed@example.com',
    stage: 'reviewed' as const,
    score: 86,
    intelConfidence: 91,
    scoreBreakdown: [
      { dimension: 'Backend Systems', score: 88, reasoning: 'Strong service ownership at scale.' },
      { dimension: 'Product Sense', score: 80, reasoning: 'References shipping user-facing workflows.' },
      { dimension: 'Startup Fit', score: 90, reasoning: 'Comfortable with ambiguity and broad scope.' },
    ],
    qualificationChecks: [
      { requirement: '3+ years backend engineering', met: true, evidence: '4 years building Node.js APIs.' },
      { requirement: 'Production cloud operations', met: true, evidence: 'Owned AWS infra and pager rotation.' },
      { requirement: 'Hiring pipeline tooling exposure', met: false, evidence: 'No direct ATS tooling listed.' },
    ],
    workHistory: [
      { company: 'Orbit Labs', role: 'Software Engineer', period: '2022-2026' },
      { company: 'Rivet Soft', role: 'Backend Engineer', period: '2020-2022' },
    ],
    summary: 'High signal backend candidate with strong startup execution profile.',
    sourceEmailMessageId: 'msg_demo_apply_002',
    sourceEmailThreadId: 'thread_demo_apply_002',
    sourceEmailReceivedAt: new Date('2026-04-01T14:40:00.000Z'),
  },
  {
    id: 'cand_demo_julian',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_product_designer',
    name: 'Julian Kim',
    contactEmail: 'julian.kim.demo+scheduled@example.com',
    stage: 'interview_scheduled' as const,
    score: 79,
    intelConfidence: 82,
    scoreBreakdown: [
      { dimension: 'UX Craft', score: 84, reasoning: 'Polished case studies and prototype detail.' },
      { dimension: 'Research Depth', score: 76, reasoning: 'Good framing, moderate quant grounding.' },
      { dimension: 'Cross-functional Communication', score: 77, reasoning: 'Examples of PM/ENG collaboration.' },
    ],
    qualificationChecks: [
      { requirement: 'Portfolio with shipped products', met: true, evidence: 'Multiple B2B product launches.' },
      { requirement: 'Design systems ownership', met: true, evidence: 'Led token and component system revamp.' },
    ],
    workHistory: [
      { company: 'Northlane', role: 'Product Designer', period: '2023-2026' },
      { company: 'Studio Alto', role: 'UX Designer', period: '2020-2023' },
    ],
    summary: 'Interview scheduled; candidate responded quickly with strong availability.',
    sourceEmailMessageId: 'msg_demo_apply_003',
    sourceEmailThreadId: 'thread_demo_apply_003',
    sourceEmailReceivedAt: new Date('2026-03-31T09:10:00.000Z'),
  },
  {
    id: 'cand_demo_priya',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_founding_engineer',
    name: 'Priya Shah',
    contactEmail: 'priya.shah.demo+interviewed@example.com',
    stage: 'interviewed' as const,
    score: 91,
    intelConfidence: 94,
    scoreBreakdown: [
      { dimension: 'System Design', score: 93, reasoning: 'Designed resilient event-driven systems.' },
      { dimension: 'Execution Velocity', score: 90, reasoning: 'Shipped multiple critical roadmap items.' },
      { dimension: 'Leadership', score: 89, reasoning: 'Mentored junior engineers and led projects.' },
    ],
    qualificationChecks: [
      { requirement: 'Strong distributed systems experience', met: true, evidence: 'Owned queue-based workflow platform.' },
      { requirement: 'Hands-on with TypeScript', met: true, evidence: 'Maintained TS services and tooling.' },
      { requirement: 'Recruiting domain familiarity', met: true, evidence: 'Built internal candidate ops dashboards.' },
    ],
    workHistory: [
      { company: 'Signal Forge', role: 'Senior Engineer', period: '2021-2026' },
      { company: 'Bluestone', role: 'Software Engineer', period: '2018-2021' },
    ],
    summary: 'Completed interview with strong technical depth and clear ownership signal.',
    sourceEmailMessageId: 'msg_demo_apply_004',
    sourceEmailThreadId: 'thread_demo_apply_004',
    sourceEmailReceivedAt: new Date('2026-03-30T17:32:00.000Z'),
  },
  {
    id: 'cand_demo_nora',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_product_designer',
    name: 'Nora Lee',
    contactEmail: 'nora.lee.demo+offer@example.com',
    stage: 'offer_sent' as const,
    score: 88,
    intelConfidence: 90,
    scoreBreakdown: [
      { dimension: 'Visual Design', score: 92, reasoning: 'Very strong product visual systems.' },
      { dimension: 'Interaction Design', score: 86, reasoning: 'Clear interaction rationale and details.' },
      { dimension: 'Team Fit', score: 85, reasoning: 'Collaborative style and practical tradeoffs.' },
    ],
    qualificationChecks: [
      { requirement: 'B2B SaaS design experience', met: true, evidence: 'Portfolio focuses on SaaS workflows.' },
      { requirement: 'End-to-end ownership', met: true, evidence: 'Led discovery through launch cycles.' },
    ],
    workHistory: [
      { company: 'Pineframe', role: 'Lead Product Designer', period: '2022-2026' },
      { company: 'Helix Studio', role: 'Product Designer', period: '2019-2022' },
    ],
    summary: 'Offer has been sent; awaiting candidate response in Gmail thread.',
    sourceEmailMessageId: 'msg_demo_apply_005',
    sourceEmailThreadId: 'thread_demo_apply_005',
    sourceEmailReceivedAt: new Date('2026-03-29T10:16:00.000Z'),
  },
  {
    id: 'cand_demo_karthik',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_founding_engineer',
    name: 'Karthik Menon',
    contactEmail: 'karthik.menon.demo+hired@example.com',
    stage: 'hired' as const,
    score: 94,
    intelConfidence: 95,
    scoreBreakdown: [
      { dimension: 'Architecture', score: 95, reasoning: 'Extensive ownership of distributed services.' },
      { dimension: 'Delivery', score: 93, reasoning: 'Consistent delivery under tight timelines.' },
      { dimension: 'Founding Mindset', score: 94, reasoning: 'Strong ambiguity tolerance and initiative.' },
    ],
    qualificationChecks: [
      { requirement: 'Startup engineering breadth', met: true, evidence: 'Handled backend, infra, and analytics.' },
      { requirement: 'Mentorship ability', met: true, evidence: 'Led onboarding and mentoring programs.' },
    ],
    workHistory: [
      { company: 'Mosaic Core', role: 'Staff Engineer', period: '2021-2026' },
      { company: 'Aster Grid', role: 'Senior Engineer', period: '2017-2021' },
    ],
    summary: 'Candidate accepted offer and moved to hired.',
    sourceEmailMessageId: 'msg_demo_apply_006',
    sourceEmailThreadId: 'thread_demo_apply_006',
    sourceEmailReceivedAt: new Date('2026-03-27T12:00:00.000Z'),
  },
  {
    id: 'cand_demo_lee',
    organizationId: DEMO_ORGANIZATION.id,
    jobId: 'job_demo_product_designer',
    name: 'Lee Wong',
    contactEmail: 'lee.wong.demo+rejected@example.com',
    stage: 'rejected' as const,
    score: 61,
    intelConfidence: 77,
    scoreBreakdown: [
      { dimension: 'Portfolio Quality', score: 68, reasoning: 'Some solid work, but limited depth.' },
      { dimension: 'Role Match', score: 58, reasoning: 'Experience leans visual branding over product UX.' },
      { dimension: 'Communication', score: 57, reasoning: 'Examples lacked concrete collaboration outcomes.' },
    ],
    qualificationChecks: [
      { requirement: 'Hands-on product workflow design', met: false, evidence: 'Portfolio emphasizes marketing collateral.' },
      { requirement: 'Cross-functional handoff experience', met: true, evidence: 'Basic examples of PM collaboration.' },
    ],
    workHistory: [
      { company: 'Arc Label', role: 'Visual Designer', period: '2021-2026' },
      { company: 'Mono Works', role: 'Brand Designer', period: '2018-2021' },
    ],
    summary: 'Rejected after review due to role mismatch for product workflow depth.',
    sourceEmailMessageId: 'msg_demo_apply_007',
    sourceEmailThreadId: 'thread_demo_apply_007',
    sourceEmailReceivedAt: new Date('2026-03-28T11:12:00.000Z'),
  },
];

const DEMO_APPLICATIONS = DEMO_CANDIDATES.map((candidate) => ({
  id: `app_${candidate.id}`,
  candidateId: candidate.id,
  jobId: candidate.jobId,
  stage: candidate.stage,
  status: 'active' as const,
}));

const DEMO_INTERVIEWS = [
  {
    id: 'int_demo_julian_01',
    organizationId: DEMO_ORGANIZATION.id,
    candidateId: 'cand_demo_julian',
    jobId: 'job_demo_product_designer',
    scheduledAt: new Date('2026-04-04T16:00:00.000Z'),
    durationMinutes: 60,
    status: 'scheduled' as const,
    googleCalendarEventId: 'evt_demo_julian_01',
    googleMeetLink: 'https://meet.google.com/demo-julian-slot',
    summary: 'Panel interview planned with design lead and PM.',
    slackMessageTs: '1712142210.000200',
  },
  {
    id: 'int_demo_priya_01',
    organizationId: DEMO_ORGANIZATION.id,
    candidateId: 'cand_demo_priya',
    jobId: 'job_demo_founding_engineer',
    scheduledAt: new Date('2026-04-01T10:30:00.000Z'),
    durationMinutes: 60,
    status: 'completed' as const,
    googleCalendarEventId: 'evt_demo_priya_01',
    googleMeetLink: 'https://meet.google.com/demo-priya-slot',
    summary: 'Interview complete; recommendation is proceed to offer hold.',
    slackMessageTs: '1712055800.000500',
  },
];

const DEMO_OFFERS = [
  {
    id: 'offer_demo_priya_awaiting',
    organizationId: DEMO_ORGANIZATION.id,
    candidateId: 'cand_demo_priya',
    jobId: 'job_demo_founding_engineer',
    status: 'awaiting_approval' as const,
    draftContent:
      'Priya, we are excited to offer you the Founding Engineer role at Headhunt Demo Labs with base salary $185,000 plus 0.45% equity.',
    terms: {
      baseSalary: 185000,
      equityPercent: 0.45,
      startDate: '2026-05-01',
      currency: 'USD',
    },
    initiatedBy: 'auth0|manager_bob',
    cibaAuthReqId: 'ciba_demo_001',
    cibaApprovedBy: null,
    sentAt: null,
    candidateResponse: null,
  },
  {
    id: 'offer_demo_nora_sent',
    organizationId: DEMO_ORGANIZATION.id,
    candidateId: 'cand_demo_nora',
    jobId: 'job_demo_product_designer',
    status: 'sent' as const,
    draftContent:
      'Nora, we are pleased to offer you the Product Designer role at Headhunt Demo Labs with base salary $145,000.',
    terms: {
      baseSalary: 145000,
      startDate: '2026-05-15',
      currency: 'USD',
    },
    initiatedBy: 'auth0|founder_alice',
    cibaAuthReqId: null,
    cibaApprovedBy: null,
    sentAt: new Date('2026-04-01T19:20:00.000Z'),
    candidateResponse: null,
  },
  {
    id: 'offer_demo_karthik_accepted',
    organizationId: DEMO_ORGANIZATION.id,
    candidateId: 'cand_demo_karthik',
    jobId: 'job_demo_founding_engineer',
    status: 'accepted' as const,
    draftContent:
      'Karthik, this confirms your acceptance for the Founding Engineer role at Headhunt Demo Labs.',
    terms: {
      baseSalary: 195000,
      equityPercent: 0.6,
      startDate: '2026-04-22',
      currency: 'USD',
    },
    initiatedBy: 'auth0|founder_alice',
    cibaAuthReqId: null,
    cibaApprovedBy: 'auth0|founder_alice',
    sentAt: new Date('2026-03-30T13:10:00.000Z'),
    candidateResponse: 'accepted' as const,
  },
];

const DEMO_AUDIT_LOGS = [
  {
    id: 'audit_demo_ingest_maya',
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'user' as const,
    actorId: 'auth0|founder_alice',
    actorDisplayName: 'Alice Founder',
    action: 'candidate.ingest.created',
    resourceType: 'candidate',
    resourceId: 'cand_demo_maya',
    metadata: {
      jobId: 'job_demo_founding_engineer',
      sourceMessageId: 'msg_demo_apply_001',
      sourceThreadId: 'thread_demo_apply_001',
    },
    result: 'success' as const,
    timestamp: new Date('2026-04-02T08:06:00.000Z'),
  },
  {
    id: 'audit_demo_triage_maya',
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent' as const,
    actorId: 'run_triage',
    actorDisplayName: 'Triage Agent',
    action: 'triage.classified',
    resourceType: 'email',
    resourceId: 'msg_demo_apply_001',
    metadata: {
      classification: 'application',
      jobId: 'job_demo_founding_engineer',
      confidence: 0.98,
      route: 'analyst',
    },
    result: 'success' as const,
    timestamp: new Date('2026-04-02T08:06:10.000Z'),
  },
  {
    id: 'audit_demo_intel_aditya',
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent' as const,
    actorId: 'generate_intel_card',
    actorDisplayName: 'Analyst Agent',
    action: 'candidate.intel.generated',
    resourceType: 'candidate',
    resourceId: 'cand_demo_aditya',
    metadata: {
      jobId: 'job_demo_founding_engineer',
      score: 86,
      confidence: 91,
    },
    result: 'success' as const,
    timestamp: new Date('2026-04-01T15:05:00.000Z'),
  },
  {
    id: 'audit_demo_schedule_julian',
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent' as const,
    actorId: 'liaison',
    actorDisplayName: 'Liaison Agent',
    action: 'interview.scheduled',
    resourceType: 'interview',
    resourceId: 'int_demo_julian_01',
    metadata: {
      candidateId: 'cand_demo_julian',
      eventId: 'evt_demo_julian_01',
    },
    result: 'success' as const,
    timestamp: new Date('2026-04-02T09:11:00.000Z'),
  },
  {
    id: 'audit_demo_offer_hold_priya',
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'agent' as const,
    actorId: 'dispatch',
    actorDisplayName: 'Dispatch Agent',
    action: 'offer.awaiting_clearance',
    resourceType: 'offer',
    resourceId: 'offer_demo_priya_awaiting',
    metadata: {
      candidateId: 'cand_demo_priya',
      initiatedBy: 'auth0|manager_bob',
      cibaAuthReqId: 'ciba_demo_001',
    },
    result: 'pending' as const,
    timestamp: new Date('2026-04-01T11:20:00.000Z'),
  },
  {
    id: 'audit_demo_offer_sent_nora',
    organizationId: DEMO_ORGANIZATION.id,
    actorType: 'user' as const,
    actorId: 'auth0|founder_alice',
    actorDisplayName: 'Alice Founder',
    action: 'offer.sent',
    resourceType: 'offer',
    resourceId: 'offer_demo_nora_sent',
    metadata: {
      candidateId: 'cand_demo_nora',
      method: 'gmail_draft_send',
    },
    result: 'success' as const,
    timestamp: new Date('2026-04-01T19:21:00.000Z'),
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not defined. Set it in .env.local before running seed:demo.');
  }

  const connection = postgres(databaseUrl);
  const db = drizzle(connection);

  const demoJobIds = DEMO_JOBS.map((job) => job.id);

  try {
    const result = await db.transaction(async (tx) => {
      if (shouldReset) {
        await tx.delete(offers).where(eq(offers.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(interviews).where(eq(interviews.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(applications).where(inArray(applications.jobId, demoJobIds));
        await tx.delete(auditLogs).where(eq(auditLogs.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(candidates).where(eq(candidates.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(templates).where(eq(templates.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(jobs).where(eq(jobs.organizationId, DEMO_ORGANIZATION.id));
        await tx.delete(organizations).where(eq(organizations.id, DEMO_ORGANIZATION.id));
      }

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

      for (const job of DEMO_JOBS) {
        await tx
          .insert(jobs)
          .values(job)
          .onConflictDoUpdate({
            target: jobs.id,
            set: {
              organizationId: job.organizationId,
              title: job.title,
              status: job.status,
              updatedAt: new Date(),
            },
          });
      }

      for (const template of DEMO_TEMPLATES) {
        await tx
          .insert(templates)
          .values(template)
          .onConflictDoUpdate({
            target: templates.id,
            set: {
              organizationId: template.organizationId,
              type: template.type,
              name: template.name,
              subject: template.subject,
              body: template.body,
              variables: template.variables,
              updatedAt: new Date(),
            },
          });
      }

      for (const candidate of DEMO_CANDIDATES) {
        await tx
          .insert(candidates)
          .values(candidate)
          .onConflictDoUpdate({
            target: candidates.id,
            set: {
              organizationId: candidate.organizationId,
              jobId: candidate.jobId,
              name: candidate.name,
              contactEmail: candidate.contactEmail,
              stage: candidate.stage,
              score: candidate.score,
              intelConfidence: candidate.intelConfidence,
              scoreBreakdown: candidate.scoreBreakdown,
              qualificationChecks: candidate.qualificationChecks,
              workHistory: candidate.workHistory,
              summary: candidate.summary,
              sourceEmailMessageId: candidate.sourceEmailMessageId,
              sourceEmailThreadId: candidate.sourceEmailThreadId,
              sourceEmailReceivedAt: candidate.sourceEmailReceivedAt,
              updatedAt: new Date(),
            },
          });
      }

      for (const application of DEMO_APPLICATIONS) {
        await tx
          .insert(applications)
          .values(application)
          .onConflictDoUpdate({
            target: applications.id,
            set: {
              candidateId: application.candidateId,
              jobId: application.jobId,
              stage: application.stage,
              status: application.status,
              updatedAt: new Date(),
            },
          });
      }

      for (const interview of DEMO_INTERVIEWS) {
        await tx
          .insert(interviews)
          .values(interview)
          .onConflictDoUpdate({
            target: interviews.id,
            set: {
              organizationId: interview.organizationId,
              candidateId: interview.candidateId,
              jobId: interview.jobId,
              scheduledAt: interview.scheduledAt,
              durationMinutes: interview.durationMinutes,
              status: interview.status,
              googleCalendarEventId: interview.googleCalendarEventId,
              googleMeetLink: interview.googleMeetLink,
              summary: interview.summary,
              slackMessageTs: interview.slackMessageTs,
              updatedAt: new Date(),
            },
          });
      }

      for (const offer of DEMO_OFFERS) {
        await tx
          .insert(offers)
          .values(offer)
          .onConflictDoUpdate({
            target: offers.id,
            set: {
              organizationId: offer.organizationId,
              candidateId: offer.candidateId,
              jobId: offer.jobId,
              status: offer.status,
              draftContent: offer.draftContent,
              terms: offer.terms,
              initiatedBy: offer.initiatedBy,
              cibaAuthReqId: offer.cibaAuthReqId,
              cibaApprovedBy: offer.cibaApprovedBy,
              sentAt: offer.sentAt,
              candidateResponse: offer.candidateResponse,
              updatedAt: new Date(),
            },
          });
      }

      for (const event of DEMO_AUDIT_LOGS) {
        await tx
          .insert(auditLogs)
          .values(event)
          .onConflictDoUpdate({
            target: auditLogs.id,
            set: {
              organizationId: event.organizationId,
              actorType: event.actorType,
              actorId: event.actorId,
              actorDisplayName: event.actorDisplayName,
              action: event.action,
              resourceType: event.resourceType,
              resourceId: event.resourceId,
              metadata: event.metadata,
              result: event.result,
              timestamp: event.timestamp,
            },
          });
      }

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
        jobIds: DEMO_JOBS.map((job) => job.id),
        candidateIds: DEMO_CANDIDATES.map((candidate) => candidate.id),
        stageCounts,
        offerStatusCounts,
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
