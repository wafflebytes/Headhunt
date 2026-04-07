import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { templates } from '@/lib/db/schema/templates';
import type { StoredJdTemplate } from '@/lib/jd-template';

const OFFER_TEMPLATE_VARIABLES = [
  'candidateName',
  'jobTitle',
  'companyName',
  'baseSalary',
  'currency',
  'startDate',
  'jobDepartment',
  'jobEmploymentType',
  'jobLocation',
  'jobCompensation',
  'jobRoleSummary',
  'jobRequirements',
  'jobResponsibilities',
  'jobPreferredQualifications',
  'jobBenefits',
  'jobHiringSignals',
  'equityPercent',
  'bonusTargetPercent',
  'signOnBonus',
  'notes',
] as const;

const DEFAULT_TEXT = 'Not specified';

type JobScopedOfferTemplateInput = {
  organizationId: string;
  jobId: string;
  jobTitle: string;
  companyName?: string | null;
  jdTemplate?: StoredJdTemplate | null;
};

export type JobScopedOfferTemplateUpsertResult = {
  templateId: string;
  templateName: string;
  inserted: boolean;
  updated: boolean;
};

function asString(value: unknown, fallback = DEFAULT_TEXT): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function summarizeList(value: unknown): string {
  const items = asStringArray(value);
  if (items.length === 0) {
    return DEFAULT_TEXT;
  }

  return items.slice(0, 5).join('; ');
}

export function buildJobScopedOfferTemplateName(jobId: string): string {
  return `offer_letter:job:${jobId.trim()}`;
}

function buildJobScopedOfferTemplate(params: {
  jobTitle: string;
  companyName: string;
  jdTemplate?: StoredJdTemplate | null;
}) {
  const jdTemplate = params.jdTemplate ?? {};

  const department = asString(jdTemplate.department);
  const employmentType = asString(jdTemplate.employmentType);
  const location = asString(jdTemplate.location);
  const compensation = asString(jdTemplate.compensation);
  const roleSummary = asString(jdTemplate.roleSummary);
  const requirementsSummary = summarizeList(jdTemplate.requirements);
  const responsibilitiesSummary = summarizeList(jdTemplate.responsibilities);
  const preferredQualificationsSummary = summarizeList(jdTemplate.preferredQualifications);
  const benefitsSummary = summarizeList(jdTemplate.benefits);
  const hiringSignalsSummary = summarizeList(jdTemplate.hiringSignals);

  const subject = 'Offer Letter: {{jobTitle}} at {{companyName}}';
  const body = [
    'Hi {{candidateName}},',
    '',
    'We are excited to extend an offer for {{jobTitle}} at {{companyName}}.',
    '',
    'Role context for this opening:',
    `- Department: ${department}`,
    `- Employment type: ${employmentType}`,
    `- Location: ${location}`,
    `- Compensation context: ${compensation}`,
    `- Role summary: ${roleSummary}`,
    `- Top requirements: ${requirementsSummary}`,
    `- Key responsibilities: ${responsibilitiesSummary}`,
    `- Preferred qualifications: ${preferredQualificationsSummary}`,
    `- Benefits snapshot: ${benefitsSummary}`,
    `- Hiring signals: ${hiringSignalsSummary}`,
    '',
    'Compensation terms for this candidate:',
    '- Base salary: {{baseSalary}}',
    '- Currency: {{currency}}',
    '- Start date: {{startDate}}',
    '- Equity (%): {{equityPercent}}',
    '- Target bonus (%): {{bonusTargetPercent}}',
    '- Sign-on bonus: {{signOnBonus}}',
    '- Notes: {{notes}}',
    '',
    'Please reply to this email with any questions.',
    '',
    'Best,',
    params.companyName,
  ].join('\n');

  return {
    subject,
    body,
    variables: [...OFFER_TEMPLATE_VARIABLES],
  };
}

export async function upsertJobScopedOfferTemplate(
  input: JobScopedOfferTemplateInput,
): Promise<JobScopedOfferTemplateUpsertResult> {
  const organizationId = input.organizationId.trim();
  const jobId = input.jobId.trim();
  const jobTitle = input.jobTitle.trim();

  if (!organizationId || !jobId || !jobTitle) {
    throw new Error('upsertJobScopedOfferTemplate requires organizationId, jobId, and jobTitle.');
  }

  const templateName = buildJobScopedOfferTemplateName(jobId);
  const template = buildJobScopedOfferTemplate({
    jobTitle,
    companyName: input.companyName?.trim() || 'Headhunt',
    jdTemplate: input.jdTemplate,
  });

  const [existing] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.organizationId, organizationId),
        eq(templates.type, 'offer_letter'),
        eq(templates.name, templateName),
      ),
    )
    .limit(1);

  if (existing?.id) {
    await db
      .update(templates)
      .set({
        subject: template.subject,
        body: template.body,
        variables: template.variables,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, existing.id));

    return {
      templateId: existing.id,
      templateName,
      inserted: false,
      updated: true,
    };
  }

  const [inserted] = await db
    .insert(templates)
    .values({
      organizationId,
      type: 'offer_letter',
      name: templateName,
      subject: template.subject,
      body: template.body,
      variables: template.variables,
    })
    .returning({ id: templates.id });

  if (!inserted?.id) {
    throw new Error('Failed to persist job-scoped offer template.');
  }

  return {
    templateId: inserted.id,
    templateName,
    inserted: true,
    updated: false,
  };
}