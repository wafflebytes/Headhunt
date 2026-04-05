export type TranscriptJdAlignmentPromptInput = {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  jobRequirements: string[];
  executiveSummary: string;
  recommendation: string;
  recommendationRationale: string;
  overallRubricScore: number;
  candidateStrengths: string[];
  candidateRisks: string[];
  actionableFollowUps: string[];
  quotedEvidence: Array<{
    quote: string;
    whyItMatters: string;
  }>;
};

export type TranscriptSlackDigestMessageInput = {
  candidateName: string;
  candidateEmail: string;
  candidateId?: string;
  jobTitle: string;
  jobId?: string;
  bookingUid?: string;
  sourceLabel: string;
  recommendation: string;
  overallRubricScore: number;
  jdFitVerdict: string;
  jdAlignmentSummary: string;
  matchedSignals: string[];
  gapSignals: string[];
  riskFlags: string[];
  founderFollowUps: string[];
};

function formatList(items: string[]): string {
  if (items.length === 0) {
    return '- none';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

function formatRequirements(requirements: string[]): string {
  if (requirements.length === 0) {
    return 'No explicit JD requirements provided. Infer fit from role title and transcript evidence.';
  }

  return requirements.map((requirement, index) => `${index + 1}. ${requirement}`).join('\n');
}

function formatQuotedEvidence(entries: Array<{ quote: string; whyItMatters: string }>): string {
  if (entries.length === 0) {
    return '- No direct quotes were provided.';
  }

  return entries
    .map((entry, index) => `${index + 1}. Quote: "${entry.quote}" | Why it matters: ${entry.whyItMatters}`)
    .join('\n');
}

export function buildTranscriptJdAlignmentPrompt(input: TranscriptJdAlignmentPromptInput): string {
  return [
    'You are a recruiting chief of staff writing a founder-ready debrief based on an interview transcript summary.',
    'Your task is to map interview evidence against the job description (JD) expectations and produce a practical decision aid.',
    'Rules:',
    '- Use only the supplied facts. Do not invent candidate history or interview details.',
    '- Keep output concise, specific, and operationally useful for startup hiring.',
    '- Matched signals should describe concrete strengths tied to JD needs.',
    '- Gap signals should describe missing, weak, or uncertain JD evidence.',
    '- Risk flags should focus on hiring risk, execution risk, or role-fit risk.',
    '- Founder follow-ups should be direct interview questions or checks to run next.',
    `Candidate: ${input.candidateName}`,
    `Candidate email: ${input.candidateEmail}`,
    `Role: ${input.jobTitle}`,
    `JD requirements:\n${formatRequirements(input.jobRequirements)}`,
    `Transcript executive summary: ${input.executiveSummary}`,
    `Recommendation from transcript summary: ${input.recommendation}`,
    `Recommendation rationale: ${input.recommendationRationale}`,
    `Overall rubric score (6-30): ${input.overallRubricScore}`,
    `Candidate strengths:\n${formatList(input.candidateStrengths)}`,
    `Candidate risks:\n${formatList(input.candidateRisks)}`,
    `Actionable follow-ups:\n${formatList(input.actionableFollowUps)}`,
    `Quoted evidence:\n${formatQuotedEvidence(input.quotedEvidence)}`,
  ].join('\n\n');
}

export function buildTranscriptSlackDigestMessage(input: TranscriptSlackDigestMessageInput): string {
  const header = [
    '*Interview Debrief*',
    `Candidate: ${input.candidateName} <${input.candidateEmail}>`,
    input.candidateId ? `Candidate ID: ${input.candidateId}` : null,
    `Role: ${input.jobTitle}`,
    input.jobId ? `Job ID: ${input.jobId}` : null,
    input.bookingUid ? `Cal booking UID: ${input.bookingUid}` : null,
    `Source: ${input.sourceLabel}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return [
    header,
    `Recommendation: ${input.recommendation}`,
    `Rubric score: ${input.overallRubricScore}/30`,
    `JD fit verdict: ${input.jdFitVerdict}`,
    `JD alignment summary: ${input.jdAlignmentSummary}`,
    '',
    '*Matched signals*',
    formatList(input.matchedSignals),
    '',
    '*Gap signals*',
    formatList(input.gapSignals),
    '',
    '*Risk flags*',
    formatList(input.riskFlags),
    '',
    '*Founder follow-ups*',
    formatList(input.founderFollowUps),
  ].join('\n');
}
