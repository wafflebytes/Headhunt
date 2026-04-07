import { z } from 'zod';

export const jdTemplateSchema = z.object({
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

export type JdTemplate = z.infer<typeof jdTemplateSchema>;
export type StoredJdTemplate = Partial<JdTemplate>;

const DEFAULT_TEXT = 'Not specified';
const DEFAULT_ARRAY_ITEM = 'Not specified';

function cleanText(value: string | undefined | null, fallback = DEFAULT_TEXT): string {
  const next = value?.trim();
  return next && next.length > 0 ? next : fallback;
}

function cleanItems(items: string[] | undefined | null, fallback = DEFAULT_ARRAY_ITEM): string[] {
  if (!Array.isArray(items)) {
    return [fallback];
  }

  const normalized = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 16);

  return normalized.length > 0 ? normalized : [fallback];
}

export function normalizeJdTemplate(template: JdTemplate): JdTemplate {
  return {
    title: cleanText(template.title),
    department: cleanText(template.department),
    employmentType: cleanText(template.employmentType),
    location: cleanText(template.location),
    compensation: cleanText(template.compensation),
    roleSummary: cleanText(template.roleSummary),
    responsibilities: cleanItems(template.responsibilities),
    requirements: cleanItems(template.requirements),
    preferredQualifications: cleanItems(template.preferredQualifications),
    benefits: cleanItems(template.benefits),
    hiringSignals: cleanItems(template.hiringSignals),
  };
}

export function buildFallbackJdTemplate(params: {
  title?: string;
  department?: string;
  roleSummary?: string;
}): JdTemplate {
  return normalizeJdTemplate({
    title: cleanText(params.title),
    department: cleanText(params.department),
    employmentType: DEFAULT_TEXT,
    location: DEFAULT_TEXT,
    compensation: DEFAULT_TEXT,
    roleSummary: cleanText(params.roleSummary),
    responsibilities: [DEFAULT_ARRAY_ITEM],
    requirements: [DEFAULT_ARRAY_ITEM],
    preferredQualifications: [DEFAULT_ARRAY_ITEM],
    benefits: [DEFAULT_ARRAY_ITEM],
    hiringSignals: [DEFAULT_ARRAY_ITEM],
  });
}

export function toStoredJdTemplate(input: unknown): StoredJdTemplate {
  const parsed = jdTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {};
  }

  return normalizeJdTemplate(parsed.data);
}

export function extractJdTemplateRequirements(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [];
  }

  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.requirements)) {
    return [];
  }

  return record.requirements
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
