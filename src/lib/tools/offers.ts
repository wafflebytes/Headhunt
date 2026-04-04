import { and, desc, eq, inArray } from 'drizzle-orm';
import { tool } from 'ai';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
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
});

type ActorRole = 'founder' | 'hiring_manager';

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

async function markOfferSent(params: {
  offerId: string;
  candidateId: string;
  jobId: string;
  organizationId: string | null;
  actorUserId: string;
  actorRole: ActorRole;
  actorTool: 'submit_offer_for_clearance' | 'poll_offer_clearance';
  approvedBy: string | null;
  method: 'founder_direct' | 'ciba_approved';
  cibaAuthReqId?: string | null;
}) {
  const sentAt = new Date();
  const updatedAt = new Date();

  await db.transaction(async (tx: typeof db) => {
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

    const canView = await canViewCandidate(actorUserId, candidate.id);
    if (!canView) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
      };
    }

    const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
    if (!job) {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: `Job ${input.jobId} not found.`,
      };
    }

    const resolvedOrganizationId = input.organizationId ?? candidate.organizationId ?? null;
    const [organization] = resolvedOrganizationId
      ? await db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, resolvedOrganizationId))
          .limit(1)
      : [];

    const [template] = await (input.templateId
      ? db
          .select({ id: templates.id, subject: templates.subject, body: templates.body })
          .from(templates)
          .where(eq(templates.id, input.templateId))
          .limit(1)
      : db
          .select({ id: templates.id, subject: templates.subject, body: templates.body })
          .from(templates)
          .where(
            and(
              eq(templates.type, 'offer_letter'),
              resolvedOrganizationId ? eq(templates.organizationId, resolvedOrganizationId) : eq(templates.type, 'offer_letter'),
            ),
          )
          .limit(1));

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
          baseSalary: salaryText,
          startDate: input.terms.startDate,
          equityLine: equityText ? `Equity: ${equityText}` : '',
          bonusLine: [bonusPercentText, signOnText ? `Sign-on bonus: ${signOnText}` : ''].filter(Boolean).join(' | '),
          notesLine: input.terms.notes ? `Notes: ${input.terms.notes}` : '',
        });

    const draftContent = [`Subject: ${subject}`, '', body].join('\n');

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

    const [offerRow] = existingDraft
      ? await db
          .update(offers)
          .set({
            organizationId: resolvedOrganizationId,
            status: 'draft',
            draftContent,
            terms: {
              ...input.terms,
              currency: normalizedCurrency,
            },
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
            terms: {
              ...input.terms,
              currency: normalizedCurrency,
            },
            initiatedBy: actorUserId,
          })
          .returning({ id: offers.id, status: offers.status, draftContent: offers.draftContent, terms: offers.terms });

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
  },
});

export const submitOfferForClearanceTool = tool({
  description:
    'Submit an offer for clearance. Founders can send immediately; hiring managers trigger CIBA founder approval and set awaiting clearance.',
  inputSchema: submitOfferForClearanceInputSchema,
  execute: async (input) => {
    const session = await auth0.getSession();
    const actorUserId = input.actorUserId ?? session?.user?.sub ?? null;

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

    const canView = await canViewCandidate(actorUserId, candidate.id);
    if (!canView) {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: `Forbidden: no candidate visibility access for ${candidate.id}.`,
      };
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

    if (actorRole === 'founder') {
      if (offerRow.status === 'sent') {
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

      const sentAt = await markOfferSent({
        offerId: offerRow.id,
        candidateId: offerRow.candidateId,
        jobId: offerRow.jobId,
        organizationId: resolvedOrganizationId,
        actorUserId,
        actorRole,
        actorTool: 'submit_offer_for_clearance',
        approvedBy: actorUserId,
        method: 'founder_direct',
      });

      return {
        check: 'submit_offer_for_clearance',
        status: 'success',
        mode: 'sent_direct',
        offerId: offerRow.id,
        candidateId: offerRow.candidateId,
        jobId: offerRow.jobId,
        stage: 'offer_sent',
        sentAt: sentAt.toISOString(),
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

    const founderUserId = resolveFounderUserId({
      sessionUserRecord,
      explicitFounderUserId: input.founderUserId,
    });

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
        bindingMessage: `Offer clearance: ${candidate.name} for ${job.title}. Compensation ${salarySnippet}. Approve to release.`,
        requestedExpirySeconds: input.requestedExpirySeconds,
      });

      const updatedAt = new Date();

      await db.transaction(async (tx: typeof db) => {
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
});

export const pollOfferClearanceTool = tool({
  description:
    'Poll CIBA clearance status for an offer. On approval, marks offer sent and advances candidate/application stage to offer_sent.',
  inputSchema: pollOfferClearanceInputSchema,
  execute: async (input) => {
    const session = await auth0.getSession();
    const actorUserId = input.actorUserId ?? session?.user?.sub ?? null;

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

    const canView = await canViewCandidate(actorUserId, offerRow.candidateId);
    if (!canView) {
      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: `Forbidden: no candidate visibility access for ${offerRow.candidateId}.`,
      };
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

        await db.transaction(async (tx: typeof db) => {
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
});
