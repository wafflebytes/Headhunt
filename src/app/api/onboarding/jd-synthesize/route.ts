import { generateObject } from 'ai';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { enqueueInitialIntakeScan } from '@/lib/automation/intake-bootstrap';
import { kickoffV2IntakeFromSession } from '@/lib/automation/v2-kickoff';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema/jobs';
import { JdTemplate, jdTemplateSchema, normalizeJdTemplate } from '@/lib/jd-template';
import { nim } from '@/lib/nim';
import {
  buildJdSynthesisFromDraftPrompt,
  buildJdSynthesisFromUploadPrompt,
} from '@/lib/prompts/jd-synthesis';

export const runtime = 'nodejs';

const KIMI_K2_MODEL_ID = 'moonshotai/kimi-k2-instruct';
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_CHARS = 20000;

const draftPayloadSchema = z.object({
  mode: z.literal('draft'),
  jobId: z.string().optional().default(''),
  organizationId: z.string().optional().default(''),
  jobTitle: z.string().optional().default(''),
  jobDepartment: z.string().optional().default(''),
  companyStage: z.string().optional().default(''),
  employmentType: z.string().optional().default(''),
  locationPolicy: z.string().optional().default(''),
  compensationRange: z.string().optional().default(''),
  mustHaveRequirements: z.string().optional().default(''),
  preferredRequirements: z.string().optional().default(''),
  coreResponsibilities: z.string().optional().default(''),
  niceToHave: z.string().optional().default(''),
  benefits: z.string().optional().default(''),
});

function truncateSourceText(value: string): string {
  if (value.length <= MAX_SOURCE_CHARS) {
    return value;
  }

  return value.slice(0, MAX_SOURCE_CHARS);
}

async function synthesizeTemplate(prompt: string): Promise<JdTemplate> {
  const { object } = await generateObject({
    model: nim.chatModel(KIMI_K2_MODEL_ID),
    schema: jdTemplateSchema,
    temperature: 0.2,
    prompt,
  });

  return normalizeJdTemplate(object);
}

async function extractPdfText(file: File): Promise<string> {
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF files are supported for upload synthesis.');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('PDF file is too large. Maximum supported size is 10MB.');
  }

  const fileBuffer = await file.arrayBuffer();
  const result = await pdf(Buffer.from(fileBuffer));
  const text = result.text?.trim();

  if (!text || text.length === 0) {
    throw new Error('Unable to extract readable text from the uploaded PDF.');
  }

  return truncateSourceText(text);
}

async function persistSynthesisToJob(params: {
  jobId?: string;
  organizationId?: string;
  actorUserId?: string;
  tokenVaultLoginHint?: string;
  synthesis: JdTemplate;
}) {
  const jobId = params.jobId?.trim();
  if (!jobId) {
    return null;
  }

  const organizationId = params.organizationId?.trim() || null;
  const jobTitle = params.synthesis.title.trim() || 'Untitled role';
  const now = new Date();

  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (existing) {
    const updatePayload: {
      title: string;
      jdTemplate: JdTemplate;
      updatedAt: Date;
      organizationId?: string | null;
    } = {
      title: jobTitle,
      jdTemplate: params.synthesis,
      updatedAt: now,
    };

    if (organizationId) {
      updatePayload.organizationId = organizationId;
    }

    await db.update(jobs).set(updatePayload).where(eq(jobs.id, jobId));
    return jobId;
  }

  const [inserted] = await db
    .insert(jobs)
    .values({
      id: jobId,
      organizationId,
      title: jobTitle,
      status: 'active',
      jdTemplate: params.synthesis,
    })
    .returning({ id: jobs.id });

  if (inserted?.id) {
    await enqueueInitialIntakeScan({
      jobId: inserted.id,
      organizationId,
      actorUserId: params.actorUserId,
      tokenVaultLoginHint: params.tokenVaultLoginHint,
      trigger: 'api.onboarding.jd-synthesize',
    });

    await kickoffV2IntakeFromSession({
      jobId: inserted.id,
      organizationId,
      actorUserId: params.actorUserId,
      tokenVaultLoginHint: params.tokenVaultLoginHint,
      trigger: 'api.onboarding.jd-synthesize',
    });
  }

  return inserted?.id ?? jobId;
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const tokenVaultLoginHint = session.user.sub;

  try {
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');

      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'PDF file is required.' }, { status: 400 });
      }

      const jobTitle = String(formData.get('jobTitle') ?? '').trim();
      const jobDepartment = String(formData.get('jobDepartment') ?? '').trim();
      const jobId = String(formData.get('jobId') ?? '').trim();
      const organizationId = String(formData.get('organizationId') ?? '').trim();
      const sourceText = await extractPdfText(file);

      const synthesis = await synthesizeTemplate(
        buildJdSynthesisFromUploadPrompt({
          jobTitle,
          jobDepartment,
          sourceText,
        }),
      );

      let persistedJobId: string | null = null;
      if (jobId) {
        try {
          persistedJobId = await persistSynthesisToJob({
            jobId,
            organizationId,
            actorUserId: session.user.sub,
            tokenVaultLoginHint,
            synthesis,
          });
        } catch {
          // Synthesis should still succeed even if persistence fails.
        }
      }

      return NextResponse.json({
        status: 'success',
        source: 'upload',
        synthesis,
        persistedJobId,
      });
    }

    const parsedBody = draftPayloadSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          message: 'Invalid draft request payload.',
          issues: parsedBody.error.issues,
        },
        { status: 400 },
      );
    }

    const payload = parsedBody.data;
    const synthesis = await synthesizeTemplate(
      buildJdSynthesisFromDraftPrompt({
        jobTitle: payload.jobTitle,
        jobDepartment: payload.jobDepartment,
        companyStage: payload.companyStage,
        employmentType: payload.employmentType,
        locationPolicy: payload.locationPolicy,
        compensationRange: payload.compensationRange,
        mustHaveRequirements: payload.mustHaveRequirements,
        preferredRequirements: payload.preferredRequirements,
        coreResponsibilities: payload.coreResponsibilities,
        niceToHave: payload.niceToHave,
        benefits: payload.benefits,
      }),
    );

    let persistedJobId: string | null = null;
    if (payload.jobId) {
      try {
        persistedJobId = await persistSynthesisToJob({
          jobId: payload.jobId,
          organizationId: payload.organizationId,
          actorUserId: session.user.sub,
          tokenVaultLoginHint,
          synthesis,
        });
      } catch {
        // Synthesis should still succeed even if persistence fails.
      }
    }

    return NextResponse.json({
      status: 'success',
      source: 'draft',
      synthesis,
      persistedJobId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to synthesize job description.',
      },
      { status: 500 },
    );
  }
}
