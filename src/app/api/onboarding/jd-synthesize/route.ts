import { generateObject } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { nim } from '@/lib/nim';
import {
  buildJdSynthesisFromDraftPrompt,
  buildJdSynthesisFromUploadPrompt,
} from '@/lib/prompts/jd-synthesis';

export const runtime = 'nodejs';

const KIMI_K2_MODEL_ID = 'moonshotai/kimi-k2-instruct';
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_CHARS = 20000;

const jdTemplateSchema = z.object({
  title: z.string(),
  department: z.string(),
  employmentType: z.string(),
  location: z.string(),
  compensation: z.string(),
  roleSummary: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  preferredQualifications: z.array(z.string()),
  benefits: z.array(z.string()),
  hiringSignals: z.array(z.string()),
});

type JdTemplate = z.infer<typeof jdTemplateSchema>;

const draftPayloadSchema = z.object({
  mode: z.literal('draft'),
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

const cleanText = (value: string | undefined | null, fallback: string) => {
  const next = value?.trim();
  return next && next.length > 0 ? next : fallback;
};

const cleanItems = (items: string[], fallback: string): string[] => {
  const normalized = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 12);

  if (normalized.length > 0) {
    return normalized;
  }

  return [fallback];
};

function normalizeTemplate(template: JdTemplate): JdTemplate {
  return {
    title: cleanText(template.title, 'Not specified'),
    department: cleanText(template.department, 'Not specified'),
    employmentType: cleanText(template.employmentType, 'Not specified'),
    location: cleanText(template.location, 'Not specified'),
    compensation: cleanText(template.compensation, 'Not specified'),
    roleSummary: cleanText(template.roleSummary, 'Not specified'),
    responsibilities: cleanItems(template.responsibilities, 'Not specified'),
    requirements: cleanItems(template.requirements, 'Not specified'),
    preferredQualifications: cleanItems(template.preferredQualifications, 'Not specified'),
    benefits: cleanItems(template.benefits, 'Not specified'),
    hiringSignals: cleanItems(template.hiringSignals, 'Not specified'),
  };
}

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

  return normalizeTemplate(object);
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

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

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
      const sourceText = await extractPdfText(file);

      const synthesis = await synthesizeTemplate(
        buildJdSynthesisFromUploadPrompt({
          jobTitle,
          jobDepartment,
          sourceText,
        }),
      );

      return NextResponse.json({
        status: 'success',
        source: 'upload',
        synthesis,
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

    return NextResponse.json({
      status: 'success',
      source: 'draft',
      synthesis,
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
