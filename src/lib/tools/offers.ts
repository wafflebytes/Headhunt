import { and, desc, eq, inArray } from 'drizzle-orm';
import { tool } from 'ai';
import { google } from 'googleapis';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { getGoogleAccessToken, withGmailWrite } from '@/lib/auth0-ai';
import { decodeJwtSubUnsafe, initiateCibaAuthorization, pollCibaAuthorization } from '@/lib/auth0-ciba';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { offerTermsSchema, offers } from '@/lib/db/schema/offers';
import { organizations } from '@/lib/db/schema/organizations';
import { templates } from '@/lib/db/schema/templates';
import { canViewCandidate } from '@/lib/fga/fga';
import { buildJobScopedOfferTemplateName } from '@/lib/offer-template-seeding';

const draftOfferLetterInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  terms: offerTermsSchema,
});

const submitOfferForClearanceInputSchema = z
  .object({
    offerId: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    organizationId: z.string().optional(),
    actorUserId: z.string().min(1).optional(),
    founderUserId: z.string().min(1).optional(),
    requestedExpirySeconds: z.number().int().min(60).max(3600).optional(),
    forceReissue: z.boolean().default(false),
    allowSystemBypass: z.boolean().optional().default(false),
  })
  .refine((value) => Boolean(value.offerId || (value.candidateId && value.jobId)), {
    message: 'Provide offerId OR candidateId and jobId.',
  });

const pollOfferClearanceInputSchema = z.object({
  offerId: z.string().min(1),
  authReqId: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  founderUserId: z.string().min(1).optional(),
  allowSystemBypass: z.boolean().optional().default(false),
});

type ActorRole = 'founder' | 'hiring_manager';

type JobDraftContext = {
  department: string;
  employmentType: string;
  location: string;
  compensation: string;
  roleSummary: string;
  requirements: string[];
  responsibilities: string[];
  preferredQualifications: string[];
  benefits: string[];
  hiringSignals: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeRoleToken(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('founder')) {
    return 'founder';
  }

  if (
    normalized.includes('hiring_manager') ||
    normalized.includes('hiringmanager') ||
    normalized === 'manager' ||
    normalized.endsWith('_manager')
  ) {
    return 'hiring_manager';
  }

  return normalized;
}

function collectRoleTokens(sessionUserRecord: Record<string, unknown> | null): Set<string> {
  const tokens = new Set<string>();

  if (!sessionUserRecord) {
    return tokens;
  }

  const addToken = (value: unknown) => {
    const token = asString(value);
    if (!token) return;

    const normalized = normalizeRoleToken(token);
    if (normalized) {
      tokens.add(normalized);
    }
  };

  const addTokenArray = (value: unknown) => {
    for (const token of asStringArray(value)) {
      const normalized = normalizeRoleToken(token);
      if (normalized) {
        tokens.add(normalized);
      }
    }
  };

  addToken(sessionUserRecord.role);
  addTokenArray(sessionUserRecord.roles);

  const appMetadata = asRecord(sessionUserRecord.app_metadata);
  addToken(appMetadata?.role);
  addTokenArray(appMetadata?.roles);

  for (const [key, value] of Object.entries(sessionUserRecord)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.endsWith('/role')) {
      addToken(value);
    } else if (lowerKey.endsWith('/roles')) {
      addTokenArray(value);
    }
  }

  return tokens;
}

function getFounderAllowList(): string[] {
  const fromList = (process.env.HEADHUNT_FOUNDER_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const single = [
    process.env.HEADHUNT_FOUNDER_USER_ID,
    process.env.AUTH0_FOUNDER_USER_ID,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set([...single, ...fromList]));
}

function resolveActorRole(params: {
  actorUserId: string;
  sessionUserRecord: Record<string, unknown> | null;
  explicitFounderUserId?: string;
}): ActorRole {
  if (params.explicitFounderUserId && params.actorUserId === params.explicitFounderUserId) {
    return 'founder';
  }

  const founderAllowList = getFounderAllowList();
  if (founderAllowList.includes(params.actorUserId)) {
    return 'founder';
  }

  const roleTokens = collectRoleTokens(params.sessionUserRecord);
  if (roleTokens.has('founder')) {
    return 'founder';
  }

  return 'hiring_manager';
}

function resolveFounderUserId(params: {
  sessionUserRecord: Record<string, unknown> | null;
  explicitFounderUserId?: string;
}): string | undefined {
  if (params.explicitFounderUserId?.trim()) {
    return params.explicitFounderUserId.trim();
  }

  const founderAllowList = getFounderAllowList();
  if (founderAllowList.length > 0) {
    return founderAllowList[0];
  }

  const appMetadata = asRecord(params.sessionUserRecord?.app_metadata);
  const metadataFounder = asString(appMetadata?.founder_user_id) ?? asString(appMetadata?.founderUserId);
  if (metadataFounder) {
    return metadataFounder;
  }

  if (params.sessionUserRecord) {
    for (const [key, value] of Object.entries(params.sessionUserRecord)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.endsWith('/founder_user_id') || lowerKey.endsWith('/founderuserid')) {
        const parsed = asString(value);
        if (parsed) {
          return parsed;
        }
      }
    }
  }

  return undefined;
}

function getOfferTermString(terms: Record<string, unknown>, key: string): string | undefined {
  return asString(terms[key]);
}

function getOfferTermNumber(terms: Record<string, unknown>, key: string): number | undefined {
  const value = terms[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatOfferSalarySnippet(terms: Record<string, unknown>): string {
  const baseSalary = getOfferTermNumber(terms, 'baseSalary');
  const currency = getOfferTermString(terms, 'currency')?.toUpperCase() ?? 'USD';

  if (typeof baseSalary !== 'number') {
    return 'salary not specified';
  }

  return formatCurrency(baseSalary, currency);
}

function buildCibaBindingMessage(params: { candidateName: string; jobTitle: string; salarySnippet: string }): string {
  const compact = `Offer approval: ${params.candidateName} ${params.jobTitle} ${params.salarySnippet}`
    .replace(/\s+/g, ' ')
    .trim();

  const sanitized = compact
    .replace(/[^a-zA-Z0-9\s+\-_,.:#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = sanitized || 'Offer approval';

  if (normalized.length <= 64) {
    return normalized;
  }

  return `${normalized.slice(0, 61)}...`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseDraftOfferContent(params: {
  draftContent: string | null;
  fallbackJobTitle: string;
}): { subject: string; body: string } {
  const fallbackSubject = `Offer Letter: ${params.fallbackJobTitle}`;
  const normalized = (params.draftContent ?? '').replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    return {
      subject: fallbackSubject,
      body: 'Please review your offer details and reply with any questions.',
    };
  }

  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (/^subject\s*:/i.test(firstLine)) {
    const subject = firstLine.replace(/^subject\s*:/i, '').trim() || fallbackSubject;
    const body = lines.slice(1).join('\n').trim() || 'Please review your offer details and reply with any questions.';
    return { subject, body };
  }

  return {
    subject: fallbackSubject,
    body: normalized,
  };
}

function buildOfferEmailMessage(params: {
  to: string;
  subject: string;
  body: string;
}): string {
  return [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${params.subject}`,
    '',
    params.body,
  ].join('\r\n');
}

async function sendOfferEmail(params: {
  offerId: string;
}): Promise<{
  providerId: string | null;
  providerThreadId: string | null;
  to: string;
  subject: string;
}> {
  const [offerContext] = await db
    .select({
      draftContent: offers.draftContent,
      candidateEmail: candidates.contactEmail,
      jobTitle: jobs.title,
    })
    .from(offers)
    .innerJoin(candidates, eq(candidates.id, offers.candidateId))
    .innerJoin(jobs, eq(jobs.id, offers.jobId))
    .where(eq(offers.id, params.offerId))
    .limit(1);

  if (!offerContext) {
    throw new Error(`Offer ${params.offerId} not found while preparing send.`);
  }

  const to = offerContext.candidateEmail?.trim();
  if (!to) {
    throw new Error(`Offer ${params.offerId} cannot be sent because candidate email is missing.`);
  }

  const { subject, body } = parseDraftOfferContent({
    draftContent: offerContext.draftContent,
    fallbackJobTitle: offerContext.jobTitle,
  });

  const accessToken = await getGoogleAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail('v1');
  const raw = toBase64Url(
    buildOfferEmailMessage({
      to,
      subject,
      body,
    }),
  );

  const sent = await gmail.users.messages.send({
    auth,
    userId: 'me',
    requestBody: { raw },
  });

  return {
    providerId: sent.data.id ?? null,
    providerThreadId: sent.data.threadId ?? null,
    to,
    subject,
  };
}

async function markOfferSent(params: {
  offerId: string;
  candidateId: string;
  jobId: string;
  organizationId: string | null;
  actorUserId: string;
  actorRole: ActorRole;
  actorTool: 'submit_offer_for_clearance' | 'poll_offer_clearance';
  approvedBy: string | null;
  method: 'ciba_approved';
  cibaAuthReqId?: string | null;
}) {
  const delivery = await sendOfferEmail({
    offerId: params.offerId,
  });

  const sentAt = new Date();
  const updatedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(offers)
      .set({
        status: 'sent',
        cibaApprovedBy: params.approvedBy,
        cibaAuthReqId: null,
        sentAt,
        updatedAt,
      })
      .where(eq(offers.id, params.offerId));

    await tx
      .update(candidates)
      .set({
        stage: 'offer_sent',
        updatedAt,
      })
      .where(eq(candidates.id, params.candidateId));

    await tx
      .update(applications)
      .set({
        stage: 'offer_sent',
        updatedAt,
      })
      .where(and(eq(applications.candidateId, params.candidateId), eq(applications.jobId, params.jobId)));

    await tx.insert(auditLogs).values({
      organizationId: params.organizationId,
      actorType: 'agent',
      actorId: params.actorTool,
      actorDisplayName: 'Dispatch Agent',
      action: 'offer.sent',
      resourceType: 'offer',
      resourceId: params.offerId,
      metadata: {
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        approvedBy: params.approvedBy,
        candidateId: params.candidateId,
        jobId: params.jobId,
        method: params.method,
        sentAt: sentAt.toISOString(),
        cibaAuthReqId: params.cibaAuthReqId ?? null,
        providerId: delivery.providerId,
        providerThreadId: delivery.providerThreadId,
        to: delivery.to,
        subject: delivery.subject,
      },
      result: 'success',
    });
  });

  return sentAt;
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => values[key] ?? '');
}

function buildDefaultOfferBody(values: {
  candidateName: string;
  jobTitle: string;
  companyName: string;
  department: string;
  employmentType: string;
  location: string;
  compensation: string;
  roleSummary: string;
  requirementsSummary: string;
  responsibilitiesSummary: string;
  baseSalary: string;
  startDate: string;
  equityLine: string;
  bonusLine: string;
  notesLine: string;
}) {
  return [
    `Hi ${values.candidateName},`,
    '',
    `We are excited to extend an offer for the ${values.jobTitle} role at ${values.companyName}.`,
    `Department: ${values.department}`,
    `Employment type: ${values.employmentType}`,
    `Location: ${values.location}`,
    `Role compensation context: ${values.compensation}`,
    `Role summary: ${values.roleSummary}`,
    `Top requirements: ${values.requirementsSummary}`,
    `Key responsibilities: ${values.responsibilitiesSummary}`,
    `Base salary: ${values.baseSalary}`,
    values.equityLine,
    values.bonusLine,
    `Start date: ${values.startDate}`,
    values.notesLine,
    '',
    'Please reply to this email with any questions.',
    '',
    'Best,',
    'Headhunt Team',
  ]
    .filter(Boolean)
    .join('\n');
}

function summarizeList(items: string[], fallback: string): string {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  return items.slice(0, 4).join('; ');
}

function resolveJobDraftContext(jdTemplate: unknown): JobDraftContext {
  const template = asRecord(jdTemplate);

  const listFromTemplate = (key: string): string[] => {
    const value = template ? template[key] : undefined;
    return asStringArray(value);
  };

  return {
    department: asString(template?.department) ?? 'Not specified',
    employmentType: asString(template?.employmentType) ?? 'Not specified',
    location: asString(template?.location) ?? 'Not specified',
    compensation: asString(template?.compensation) ?? 'Not specified',
    roleSummary: asString(template?.roleSummary) ?? 'Not specified',
    requirements: listFromTemplate('requirements'),
    responsibilities: listFromTemplate('responsibilities'),
    preferredQualifications: listFromTemplate('preferredQualifications'),
    benefits: listFromTemplate('benefits'),
    hiringSignals: listFromTemplate('hiringSignals'),
  };
}

export const draftOfferLetterTool = tool({
  description:
    'Create or update an offer letter draft with structured terms and persist the draft in the offers table.',
  inputSchema: draftOfferLetterInputSchema,
  execute: async (input) => {
    const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

    if (!actorUserId) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: 'Unauthorized: missing actor identity for offer drafting.',
      };
    }

    let failureStep = 'load_candidate';

    try {

    const [candidate] = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        contactEmail: candidates.contactEmail,
        organizationId: candidates.organizationId,
      })
      .from(candidates)
      .where(eq(candidates.id, input.candidateId))
      .limit(1);

    if (!candidate) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: `Candidate ${input.candidateId} not found.`,
      };
    }

    failureStep = 'check_candidate_visibility';
    const canView = await canViewCandidate(actorUserId, candidate.id);
    if (!canView) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
      };
    }

    failureStep = 'load_job';
    const [job] = await db
      .select({ id: jobs.id, title: jobs.title, jdTemplate: jobs.jdTemplate })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .limit(1);
    if (!job) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: `Job ${input.jobId} not found.`,
      };
    }

    const jobContext = resolveJobDraftContext(job.jdTemplate);

    const resolvedOrganizationId = input.organizationId ?? candidate.organizationId ?? null;
    failureStep = 'load_organization';
    const [organization] = resolvedOrganizationId
      ? await db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, resolvedOrganizationId))
          .limit(1)
      : [];

    failureStep = 'load_template';
    let template: { id: string; subject: string; body: string } | undefined;

    if (input.templateId) {
      [template] = await db
        .select({ id: templates.id, subject: templates.subject, body: templates.body })
        .from(templates)
        .where(eq(templates.id, input.templateId))
        .limit(1);
    } else {
      if (resolvedOrganizationId) {
        const [jobScopedTemplate] = await db
          .select({ id: templates.id, subject: templates.subject, body: templates.body })
          .from(templates)
          .where(
            and(
              eq(templates.type, 'offer_letter'),
              eq(templates.organizationId, resolvedOrganizationId),
              eq(templates.name, buildJobScopedOfferTemplateName(job.id)),
            ),
          )
          .limit(1);

        template = jobScopedTemplate;
      }

      if (!template) {
        [template] = await db
          .select({ id: templates.id, subject: templates.subject, body: templates.body })
          .from(templates)
          .where(
            and(
              eq(templates.type, 'offer_letter'),
              resolvedOrganizationId
                ? eq(templates.organizationId, resolvedOrganizationId)
                : eq(templates.type, 'offer_letter'),
            ),
          )
          .limit(1);
      }
    }

    const normalizedCurrency = input.terms.currency.toUpperCase();
    const salaryText = formatCurrency(input.terms.baseSalary, normalizedCurrency);
    const signOnText =
      typeof input.terms.signOnBonus === 'number' ? formatCurrency(input.terms.signOnBonus, normalizedCurrency) : null;
    const equityText = typeof input.terms.equityPercent === 'number' ? `${input.terms.equityPercent}% equity` : null;
    const bonusPercentText =
      typeof input.terms.bonusTargetPercent === 'number' ? `${input.terms.bonusTargetPercent}% target bonus` : null;

    const interpolationValues = {
      candidateName: candidate.name,
      jobTitle: job.title,
      companyName: organization?.name ?? 'Headhunt',
      baseSalary: salaryText,
      currency: normalizedCurrency,
      startDate: input.terms.startDate,
      jobDepartment: jobContext.department,
      jobEmploymentType: jobContext.employmentType,
      jobLocation: jobContext.location,
      jobCompensation: jobContext.compensation,
      jobRoleSummary: jobContext.roleSummary,
      jobRequirements: summarizeList(jobContext.requirements, 'Not specified'),
      jobResponsibilities: summarizeList(jobContext.responsibilities, 'Not specified'),
      jobPreferredQualifications: summarizeList(jobContext.preferredQualifications, 'Not specified'),
      jobBenefits: summarizeList(jobContext.benefits, 'Not specified'),
      jobHiringSignals: summarizeList(jobContext.hiringSignals, 'Not specified'),
      equityPercent: input.terms.equityPercent?.toString() ?? '',
      bonusTargetPercent: input.terms.bonusTargetPercent?.toString() ?? '',
      signOnBonus: signOnText ?? '',
      notes: input.terms.notes ?? '',
    };

    const subject = template
      ? renderTemplate(template.subject, interpolationValues)
      : `Offer Letter: ${job.title} at ${interpolationValues.companyName}`;

    const body = template
      ? renderTemplate(template.body, interpolationValues)
      : buildDefaultOfferBody({
          candidateName: candidate.name,
          jobTitle: job.title,
          companyName: interpolationValues.companyName,
          department: interpolationValues.jobDepartment,
          employmentType: interpolationValues.jobEmploymentType,
          location: interpolationValues.jobLocation,
          compensation: interpolationValues.jobCompensation,
          roleSummary: interpolationValues.jobRoleSummary,
          requirementsSummary: interpolationValues.jobRequirements,
          responsibilitiesSummary: interpolationValues.jobResponsibilities,
          baseSalary: salaryText,
          startDate: input.terms.startDate,
          equityLine: equityText ? `Equity: ${equityText}` : '',
          bonusLine: [bonusPercentText, signOnText ? `Sign-on bonus: ${signOnText}` : ''].filter(Boolean).join(' | '),
          notesLine: input.terms.notes ? `Notes: ${input.terms.notes}` : '',
        });

    const draftContent = [`Subject: ${subject}`, '', body].join('\n');

    failureStep = 'load_existing_draft';
    const [existingDraft] = await db
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.candidateId, input.candidateId),
          eq(offers.jobId, input.jobId),
          inArray(offers.status, ['draft', 'awaiting_approval']),
        ),
      )
      .orderBy(desc(offers.updatedAt))
      .limit(1);

    const updatedAt = new Date();

    const normalizedTerms = Object.fromEntries(
      Object.entries({
        ...input.terms,
        currency: normalizedCurrency,
      }).filter(([, value]) => value !== undefined),
    );

    failureStep = existingDraft ? 'update_offer_draft' : 'create_offer_draft';
    const [offerRow] = existingDraft
      ? await db
          .update(offers)
          .set({
            organizationId: resolvedOrganizationId,
            status: 'draft',
            draftContent,
            terms: normalizedTerms,
            initiatedBy: actorUserId,
            updatedAt,
          })
          .where(eq(offers.id, existingDraft.id))
          .returning({ id: offers.id, status: offers.status, draftContent: offers.draftContent, terms: offers.terms })
      : await db
          .insert(offers)
          .values({
            organizationId: resolvedOrganizationId,
            candidateId: input.candidateId,
            jobId: input.jobId,
            status: 'draft',
            draftContent,
            terms: normalizedTerms,
            initiatedBy: actorUserId,
          })
          .returning({ id: offers.id, status: offers.status, draftContent: offers.draftContent, terms: offers.terms });

    failureStep = 'write_offer_audit_log';
    await db.insert(auditLogs).values({
      organizationId: resolvedOrganizationId,
      actorType: 'agent',
      actorId: 'draft_offer_letter',
      actorDisplayName: 'Dispatch Agent',
      action: existingDraft ? 'offer.draft.updated' : 'offer.draft.created',
      resourceType: 'offer',
      resourceId: offerRow.id,
      metadata: {
        actorUserId,
        candidateId: input.candidateId,
        jobId: input.jobId,
        templateId: template?.id ?? null,
        baseSalary: input.terms.baseSalary,
        currency: normalizedCurrency,
        startDate: input.terms.startDate,
      },
      result: 'success',
    });

    return {
      check: 'draft_offer_letter',
      status: 'success',
      mode: existingDraft ? 'update' : 'create',
      offerId: offerRow.id,
      candidateId: input.candidateId,
      jobId: input.jobId,
      stage: 'interviewed',
      offer: {
        status: offerRow.status,
        subject,
        draftContent: offerRow.draftContent,
        terms: offerRow.terms,
      },
    };

    } catch (error) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: `draft_offer_letter failed at ${failureStep}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      };
    }
  },
});

export const submitOfferForClearanceTool = withGmailWrite(tool({
  description:
    'Submit an offer for founder CIBA clearance. Offer email is sent only after CIBA approval is confirmed by poll_offer_clearance.',
  inputSchema: submitOfferForClearanceInputSchema,
  execute: async (input) => {
    const session = await auth0.getSession();
    const allowSystemBypass = input.allowSystemBypass === true;
    const actorUserId = input.actorUserId ?? session?.user?.sub ?? (allowSystemBypass ? 'automation.worker' : null);

    if (!actorUserId) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: 'Unauthorized: missing actor identity for offer clearance.',
      };
    }

    const sessionUserRecord = asRecord(session?.user);

    const [offerRow] = input.offerId
      ? await db
          .select({
            id: offers.id,
            candidateId: offers.candidateId,
            jobId: offers.jobId,
            organizationId: offers.organizationId,
            status: offers.status,
            terms: offers.terms,
            cibaAuthReqId: offers.cibaAuthReqId,
          })
          .from(offers)
          .where(eq(offers.id, input.offerId))
          .limit(1)
      : await db
          .select({
            id: offers.id,
            candidateId: offers.candidateId,
            jobId: offers.jobId,
            organizationId: offers.organizationId,
            status: offers.status,
            terms: offers.terms,
            cibaAuthReqId: offers.cibaAuthReqId,
          })
          .from(offers)
          .where(and(eq(offers.candidateId, input.candidateId!), eq(offers.jobId, input.jobId!)))
          .orderBy(desc(offers.updatedAt))
          .limit(1);

    if (!offerRow) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: 'Offer not found. Draft an offer first, then submit it for clearance.',
      };
    }

    if (offerRow.status === 'accepted' || offerRow.status === 'declined' || offerRow.status === 'withdrawn') {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: `Offer ${offerRow.id} is already ${offerRow.status} and cannot be submitted for clearance.`,
      };
    }

    const [candidate] = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        organizationId: candidates.organizationId,
      })
      .from(candidates)
      .where(eq(candidates.id, offerRow.candidateId))
      .limit(1);

    if (!candidate) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: `Candidate ${offerRow.candidateId} not found for offer ${offerRow.id}.`,
      };
    }

    if (!allowSystemBypass) {
      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'submit_offer_for_clearance',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${candidate.id}.`,
        };
      }
    }

    const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, offerRow.jobId)).limit(1);
    if (!job) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: `Job ${offerRow.jobId} not found for offer ${offerRow.id}.`,
      };
    }

    const resolvedOrganizationId = input.organizationId ?? offerRow.organizationId ?? candidate.organizationId ?? null;
    const actorRole = resolveActorRole({
      actorUserId,
      sessionUserRecord,
      explicitFounderUserId: input.founderUserId,
    });

    if (offerRow.status === 'sent' && !input.forceReissue) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'success',
        mode: 'already_sent',
        offerId: offerRow.id,
        candidateId: offerRow.candidateId,
        jobId: offerRow.jobId,
        stage: 'offer_sent',
      };
    }

    if (!input.forceReissue && offerRow.status === 'awaiting_approval' && offerRow.cibaAuthReqId) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'success',
        mode: 'awaiting_clearance',
        offerId: offerRow.id,
        candidateId: offerRow.candidateId,
        jobId: offerRow.jobId,
        cibaAuthReqId: offerRow.cibaAuthReqId,
        message: 'Offer is already awaiting founder clearance. Poll clearance status to continue.',
      };
    }

    const founderUserId =
      resolveFounderUserId({
        sessionUserRecord,
        explicitFounderUserId: input.founderUserId,
      }) ??
      (actorRole === 'founder' && actorUserId !== 'automation.worker' ? actorUserId : undefined);

    if (!founderUserId) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message:
          'Founder user id is not configured. Provide founderUserId or set HEADHUNT_FOUNDER_USER_ID / HEADHUNT_FOUNDER_USER_IDS.',
      };
    }

    try {
      const terms = asRecord(offerRow.terms) ?? {};
      const salarySnippet = formatOfferSalarySnippet(terms);
      const cibaRequest = await initiateCibaAuthorization({
        founderUserId,
        bindingMessage: buildCibaBindingMessage({
          candidateName: candidate.name,
          jobTitle: job.title,
          salarySnippet,
        }),
        requestedExpirySeconds: input.requestedExpirySeconds,
      });

      const updatedAt = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(offers)
          .set({
            status: 'awaiting_approval',
            initiatedBy: actorUserId,
            cibaAuthReqId: cibaRequest.authReqId,
            cibaApprovedBy: null,
            sentAt: null,
            updatedAt,
          })
          .where(eq(offers.id, offerRow.id));

        await tx.insert(auditLogs).values({
          organizationId: resolvedOrganizationId,
          actorType: 'agent',
          actorId: 'submit_offer_for_clearance',
          actorDisplayName: 'Dispatch Agent',
          action: 'offer.awaiting_clearance',
          resourceType: 'offer',
          resourceId: offerRow.id,
          metadata: {
            actorUserId,
            actorRole,
            candidateId: offerRow.candidateId,
            jobId: offerRow.jobId,
            founderUserId,
            cibaAuthReqId: cibaRequest.authReqId,
            expiresAt: cibaRequest.expiresAtISO,
            pollIntervalSeconds: cibaRequest.intervalSeconds,
          },
          result: 'pending',
        });
      });

      return {
        check: 'submit_offer_for_clearance',
        status: 'success',
        mode: 'awaiting_clearance',
        offerId: offerRow.id,
        candidateId: offerRow.candidateId,
        jobId: offerRow.jobId,
        stage: 'interviewed',
        cibaAuthReqId: cibaRequest.authReqId,
        expiresAt: cibaRequest.expiresAtISO,
        pollIntervalSeconds: cibaRequest.intervalSeconds,
      };
    } catch (error) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to initiate CIBA clearance request.',
      };
    }
  },
}));

export const pollOfferClearanceTool = withGmailWrite(tool({
  description:
    'Poll CIBA clearance status for an offer. On approval, marks offer sent and advances candidate/application stage to offer_sent.',
  inputSchema: pollOfferClearanceInputSchema,
  execute: async (input) => {
    const session = await auth0.getSession();
    const allowSystemBypass = input.allowSystemBypass === true;
    const actorUserId = input.actorUserId ?? session?.user?.sub ?? (allowSystemBypass ? 'automation.worker' : null);

    if (!actorUserId) {
      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: 'Unauthorized: missing actor identity for clearance polling.',
      };
    }

    const [offerRow] = await db
      .select({
        id: offers.id,
        candidateId: offers.candidateId,
        jobId: offers.jobId,
        organizationId: offers.organizationId,
        status: offers.status,
        cibaAuthReqId: offers.cibaAuthReqId,
      })
      .from(offers)
      .where(eq(offers.id, input.offerId))
      .limit(1);

    if (!offerRow) {
      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: `Offer ${input.offerId} not found.`,
      };
    }

    if (!allowSystemBypass) {
      const canView = await canViewCandidate(actorUserId, offerRow.candidateId);
      if (!canView) {
        return {
          check: 'poll_offer_clearance',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${offerRow.candidateId}.`,
        };
      }
    }

    if (offerRow.status === 'sent') {
      return {
        check: 'poll_offer_clearance',
        status: 'success',
        mode: 'already_sent',
        offerId: offerRow.id,
        candidateId: offerRow.candidateId,
        jobId: offerRow.jobId,
        stage: 'offer_sent',
      };
    }

    const authReqId = input.authReqId ?? offerRow.cibaAuthReqId;
    if (!authReqId) {
      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: `Offer ${offerRow.id} has no CIBA auth request id to poll.`,
      };
    }

    const sessionUserRecord = asRecord(session?.user);
    const actorRole = resolveActorRole({
      actorUserId,
      sessionUserRecord,
      explicitFounderUserId: input.founderUserId,
    });

    const resolvedOrganizationId = input.organizationId ?? offerRow.organizationId ?? null;

    try {
      const pollResult = await pollCibaAuthorization({ authReqId });

      if (pollResult.status === 'pending') {
        const updatedAt = new Date();

        if (offerRow.status !== 'awaiting_approval') {
          await db
            .update(offers)
            .set({
              status: 'awaiting_approval',
              cibaAuthReqId: authReqId,
              updatedAt,
            })
            .where(eq(offers.id, offerRow.id));
        }

        return {
          check: 'poll_offer_clearance',
          status: 'success',
          mode: 'awaiting_clearance',
          offerId: offerRow.id,
          candidateId: offerRow.candidateId,
          jobId: offerRow.jobId,
          cibaAuthReqId: authReqId,
          pollAfterSeconds: pollResult.pollAfterSeconds,
          message: pollResult.message,
        };
      }

      if (pollResult.status === 'denied' || pollResult.status === 'expired') {
        const updatedAt = new Date();

        await db.transaction(async (tx) => {
          await tx
            .update(offers)
            .set({
              status: 'draft',
              cibaAuthReqId: null,
              cibaApprovedBy: null,
              updatedAt,
            })
            .where(eq(offers.id, offerRow.id));

          await tx.insert(auditLogs).values({
            organizationId: resolvedOrganizationId,
            actorType: 'agent',
            actorId: 'poll_offer_clearance',
            actorDisplayName: 'Dispatch Agent',
            action: 'offer.clearance.denied',
            resourceType: 'offer',
            resourceId: offerRow.id,
            metadata: {
              actorUserId,
              actorRole,
              candidateId: offerRow.candidateId,
              jobId: offerRow.jobId,
              cibaAuthReqId: authReqId,
              clearanceStatus: pollResult.status,
              message: pollResult.message,
            },
            result: 'denied',
          });
        });

        return {
          check: 'poll_offer_clearance',
          status: 'success',
          mode: pollResult.status === 'denied' ? 'clearance_denied' : 'clearance_expired',
          offerId: offerRow.id,
          candidateId: offerRow.candidateId,
          jobId: offerRow.jobId,
          stage: 'interviewed',
          message: pollResult.message,
        };
      }

      if (pollResult.status === 'approved') {
        const approvedBy =
          decodeJwtSubUnsafe(pollResult.idToken ?? pollResult.accessToken) ??
          resolveFounderUserId({
            sessionUserRecord,
            explicitFounderUserId: input.founderUserId,
          }) ??
          null;

        const sentAt = await markOfferSent({
          offerId: offerRow.id,
          candidateId: offerRow.candidateId,
          jobId: offerRow.jobId,
          organizationId: resolvedOrganizationId,
          actorUserId,
          actorRole,
          actorTool: 'poll_offer_clearance',
          approvedBy,
          method: 'ciba_approved',
          cibaAuthReqId: authReqId,
        });

        return {
          check: 'poll_offer_clearance',
          status: 'success',
          mode: 'sent_after_clearance',
          offerId: offerRow.id,
          candidateId: offerRow.candidateId,
          jobId: offerRow.jobId,
          stage: 'offer_sent',
          approvedBy,
          sentAt: sentAt.toISOString(),
        };
      }

      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: pollResult.message,
      };
    } catch (error) {
      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to poll CIBA clearance request.',
      };
    }
  },
}));
