export type JdSynthesisUploadPromptInput = {
  jobTitle: string;
  jobDepartment: string;
  sourceText: string;
};

export type JdSynthesisDraftPromptInput = {
  jobTitle: string;
  jobDepartment: string;
  companyStage: string;
  employmentType: string;
  locationPolicy: string;
  compensationRange: string;
  mustHaveRequirements: string;
  preferredRequirements: string;
  coreResponsibilities: string;
  niceToHave: string;
  benefits: string;
};

const traditionalTemplateContract = [
  'Return a traditional job description template in structured fields.',
  'Always fill these fields: title, department, employmentType, location, compensation, roleSummary, responsibilities, requirements, preferredQualifications, benefits, hiringSignals.',
  'If data is missing, use explicit placeholders like "Not specified" instead of leaving fields empty.',
  'Responsibilities, requirements, preferredQualifications, benefits, and hiringSignals must be practical bullet-style statements.',
  'Keep language concise, professional, and recruiter-friendly.',
].join('\n');

export function buildJdSynthesisFromUploadPrompt(input: JdSynthesisUploadPromptInput): string {
  return [
    'You are a senior recruiting operations specialist.',
    'Your task is to synthesize a clean traditional job description template from a raw JD source document.',
    traditionalTemplateContract,
    'Use the provided Job Title and Department as the primary anchor when normalizing unclear source wording.',
    'Keep compensation and location grounded in source text where available, otherwise mark as "Not specified".',
    `Job Title (user field): ${input.jobTitle || 'Not specified'}`,
    `Job Department (user field): ${input.jobDepartment || 'Not specified'}`,
    'Raw JD source text:',
    input.sourceText,
  ].join('\n\n');
}

export function buildJdSynthesisFromDraftPrompt(input: JdSynthesisDraftPromptInput): string {
  return [
    'You are a senior recruiting operations specialist.',
    'Your task is to generate a traditional job description template from intake answers.',
    traditionalTemplateContract,
    'Generate a coherent, publishable JD that reflects the user input while keeping reasonable defaults where input is sparse.',
    `Job Title (user field): ${input.jobTitle || 'Not specified'}`,
    `Job Department (user field): ${input.jobDepartment || 'Not specified'}`,
    `Company stage: ${input.companyStage || 'Not specified'}`,
    `Employment type: ${input.employmentType || 'Not specified'}`,
    `Location policy: ${input.locationPolicy || 'Not specified'}`,
    `Compensation range: ${input.compensationRange || 'Not specified'}`,
    `Must-have requirements: ${input.mustHaveRequirements || 'Not specified'}`,
    `Preferred requirements: ${input.preferredRequirements || 'Not specified'}`,
    `Core responsibilities: ${input.coreResponsibilities || 'Not specified'}`,
    `Nice-to-have skills: ${input.niceToHave || 'Not specified'}`,
    `Benefits or perks: ${input.benefits || 'Not specified'}`,
  ].join('\n\n');
}
