export type ConsensusAgent = 'technical' | 'social' | 'ats_objective';

export type CandidateConsensusContext = {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  requirements: string[];
  emailText: string;
  resumeText: string;
  additionalEvidence: string;
};

export type ConsensusTurnSnapshot = {
  agent: ConsensusAgent;
  turn: number;
  score: number;
  confidence: number;
  rationale: string;
  keyEvidence: string[];
  adjustmentNote?: string;
};

function formatRequirements(requirements: string[]): string {
  if (requirements.length === 0) {
    return 'No explicit requirements provided. Infer objective role expectations from the job title only.';
  }

  return requirements.map((requirement, index) => `${index + 1}. ${requirement}`).join('\n');
}

function formatPriorSnapshots(params: {
  snapshots: ConsensusTurnSnapshot[];
  turn: number;
  excludeAgent: ConsensusAgent;
}): string {
  const rows = params.snapshots
    .filter((snapshot) => snapshot.turn < params.turn)
    .filter((snapshot) => snapshot.agent !== params.excludeAgent)
    .map((snapshot) => {
      const adjustment = snapshot.adjustmentNote ? ` | Adjustment: ${snapshot.adjustmentNote}` : '';
      return [
        `Agent: ${snapshot.agent}`,
        `Turn: ${snapshot.turn}`,
        `Score: ${snapshot.score}`,
        `Confidence: ${snapshot.confidence}`,
        `Rationale: ${snapshot.rationale}`,
        `Evidence: ${snapshot.keyEvidence.join(' | ')}`,
      ].join(' | ') + adjustment;
    });

  if (rows.length === 0) {
    return 'No prior peer feedback available.';
  }

  return rows.join('\n');
}

function buildSharedContext(context: CandidateConsensusContext): string {
  return [
    `Candidate: ${context.candidateName}`,
    `Candidate email: ${context.candidateEmail}`,
    `Role: ${context.jobTitle}`,
    `Requirements:\n${formatRequirements(context.requirements)}`,
    `Application email text:\n${context.emailText || '(none provided)'}`,
    `Resume text:\n${context.resumeText || '(none provided)'}`,
    `Additional evidence:\n${context.additionalEvidence || '(none provided)'}`,
  ].join('\n\n');
}

export function buildTechnicalEvaluatorPrompt(params: {
  context: CandidateConsensusContext;
  turn: number;
  maxTurns: number;
  snapshots: ConsensusTurnSnapshot[];
}): string {
  const peerFeedback = formatPriorSnapshots({
    snapshots: params.snapshots,
    turn: params.turn,
    excludeAgent: 'technical',
  });

  return [
    'You are Evaluator A: Technical Fit Specialist for recruiting.',
    'Evaluate requirement-to-evidence matching, relevant project depth, system design exposure, and production impact.',
    'Scoring scale is 0-100. Confidence is 0-100 based on evidence quality and consistency.',
    'Do not invent facts. Use only supplied evidence.',
    `Turn ${params.turn} of ${params.maxTurns}.`,
    params.turn > 1
      ? 'Adjust your score only when peer evidence changes your view. Explain what changed in adjustmentNote.'
      : 'Provide an initial independent technical assessment.',
    'Return concise evidence points grounded in candidate text.',
    `Peer feedback from previous turns:\n${peerFeedback}`,
    buildSharedContext(params.context),
  ].join('\n\n');
}

export function buildSocialEvaluatorPrompt(params: {
  context: CandidateConsensusContext;
  turn: number;
  maxTurns: number;
  snapshots: ConsensusTurnSnapshot[];
}): string {
  const peerFeedback = formatPriorSnapshots({
    snapshots: params.snapshots,
    turn: params.turn,
    excludeAgent: 'social',
  });

  return [
    'You are Evaluator B: Communication, Professional Tone, and Motivation Specialist.',
    'Evaluate communication clarity, collaboration signals, ownership tone, response quality, and eagerness indicators.',
    'Scoring scale is 0-100. Confidence is 0-100.',
    'Avoid personality speculation. Assess only textual behavior and explicit evidence.',
    `Turn ${params.turn} of ${params.maxTurns}.`,
    params.turn > 1
      ? 'Revise only when peer evidence materially changes your prior assessment. Explain revision in adjustmentNote.'
      : 'Provide an initial independent communication and motivation assessment.',
    `Peer feedback from previous turns:\n${peerFeedback}`,
    buildSharedContext(params.context),
  ].join('\n\n');
}

export function buildAtsEvaluatorPrompt(params: {
  context: CandidateConsensusContext;
  turn: number;
  maxTurns: number;
  snapshots: ConsensusTurnSnapshot[];
}): string {
  const peerFeedback = formatPriorSnapshots({
    snapshots: params.snapshots,
    turn: params.turn,
    excludeAgent: 'ats_objective',
  });

  return [
    'You are Evaluator C: Objective ATS-Style Requirement Matching Specialist.',
    'You must be non-subjective. Focus strictly on requirement coverage and evidence completeness.',
    'Scoring scale is 0-100. Confidence is 0-100.',
    'For requirementChecks, each item must include requirement, met(boolean), and evidence.',
    'If explicit requirements are missing, derive 3-5 objective requirements from role title and available evidence.',
    `Turn ${params.turn} of ${params.maxTurns}.`,
    params.turn > 1
      ? 'Update score only if peer evidence reveals objective requirement mismatches previously missed.'
      : 'Provide initial objective requirement coverage assessment.',
    `Peer feedback from previous turns:\n${peerFeedback}`,
    buildSharedContext(params.context),
  ].join('\n\n');
}

export function buildConsensusPrompt(params: {
  context: CandidateConsensusContext;
  turns: number;
  weightedBaselineScore: number;
  weights: {
    technical: number;
    social: number;
    atsObjective: number;
  };
  finalSnapshots: ConsensusTurnSnapshot[];
}): string {
  const finalByAgent = params.finalSnapshots
    .sort((a, b) => a.agent.localeCompare(b.agent))
    .map((snapshot) => {
      const adjustment = snapshot.adjustmentNote ? ` | Adjustment note: ${snapshot.adjustmentNote}` : '';
      return [
        `Agent: ${snapshot.agent}`,
        `Final turn: ${snapshot.turn}`,
        `Score: ${snapshot.score}`,
        `Confidence: ${snapshot.confidence}`,
        `Rationale: ${snapshot.rationale}`,
        `Evidence: ${snapshot.keyEvidence.join(' | ')}`,
      ].join(' | ') + adjustment;
    })
    .join('\n');

  return [
    'You are the Consensus Scoring Arbiter for recruiting ops.',
    'Combine three evaluator outputs into one final hiring score and recommendation.',
    'Use these weights exactly: technical 45, social 20, ats objective 35.',
    `Weighted baseline score from arithmetic combination is ${params.weightedBaselineScore}.`,
    'You may adjust baseline only with explicit evidence-based rationale.',
    'Return clear strengths, risks, and executable next steps.',
    'Disagreements should capture unresolved evaluator conflicts only.',
    `Turns completed: ${params.turns}.`,
    `Final evaluator snapshots:\n${finalByAgent}`,
    buildSharedContext(params.context),
  ].join('\n\n');
}
