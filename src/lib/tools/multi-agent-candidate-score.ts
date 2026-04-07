import { and, eq } from 'drizzle-orm';
import { generateObject, tool } from 'ai';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import {
  candidateQualificationCheckSchema,
  candidateScoreBreakdownItemSchema,
  candidates,
} from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';
import { nim, nimChatModelId } from '@/lib/nim';
import {
  buildAtsEvaluatorPrompt,
  buildConsensusPrompt,
  buildSocialEvaluatorPrompt,
  buildTechnicalEvaluatorPrompt,
  type CandidateConsensusContext,
  type ConsensusAgent,
  type ConsensusTurnSnapshot,
} from '@/lib/prompts/candidate-consensus';

const AGENT_WEIGHTS = {
  technical: 0.45,
  social: 0.2,
  atsObjective: 0.35,
} as const;

const AGENTS: ConsensusAgent[] = ['technical', 'social', 'ats_objective'];
const AUTOMATION_FAST_TURNS = 1;
const AUTOMATION_FAST_MAX_EVIDENCE_CHARS = 2500;

const evaluatorAssessmentSchema = z.object({
  score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  rationale: z.string().min(1),
  evidencePoints: z.array(z.string().min(1)).min(2).max(6),
  adjustmentNote: z.string().min(1).optional(),
  requirementChecks: z.array(candidateQualificationCheckSchema).min(1).max(12).optional(),
});

const consensusOutputSchema = z.object({
  finalScore: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  recommendation: z.enum(['Strong Hire', 'Hire', 'Leaning Hire', 'Leaning No-Hire', 'No-Hire']),
  rationale: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(2).max(6),
  risks: z.array(z.string().min(1)).min(1).max(6),
  nextSteps: z.array(z.string().min(1)).min(3).max(8),
  disagreements: z.array(z.string().min(1)).max(5),
});

const multiAgentScoreInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  emailText: z.string().optional(),
  resumeText: z.string().optional(),
  externalContext: z.string().optional(),
  requirements: z.array(z.string().min(1)).optional(),
  turns: z.number().int().min(1).max(3).default(3),
  maxEvidenceChars: z.number().int().min(2000).max(24000).default(9000),
  automationMode: z.boolean().default(false),
});

type EvaluatorAssessment = z.infer<typeof evaluatorAssessmentSchema>;
type ConsensusOutput = z.infer<typeof consensusOutputSchema>;

function compact(value: string, maxChars: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function truncateForModel(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n\n[Evidence truncated to ${maxChars} characters]`;
}

function dedupeNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripQuotedThread(value: string): string {
  const normalized = normalizeNewlines(value);

  const cutPatterns: RegExp[] = [
    /^-----Original Message-----$/m,
    /^On\s.+\bwrote:$/m,
    /^From:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+/m,
  ];

  let cutIndex = normalized.length;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(normalized);
    if (match && typeof match.index === 'number' && match.index >= 0 && match.index < cutIndex) {
      cutIndex = match.index;
    }
  }

  return (cutIndex < normalized.length ? normalized.slice(0, cutIndex) : normalized).trim();
}

function inferResumeTextFromEmail(emailText: string): string {
  const stripped = stripQuotedThread(emailText || '').trim();
  if (stripped.length < 200) return '';

  const lines = normalizeNewlines(stripped)
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, '').trimEnd());

  const headingPatterns: RegExp[] = [
    /^professional experience\b/i,
    /^experience\b/i,
    /^work history\b/i,
    /^employment\b/i,
    /^projects\b/i,
    /^education\b/i,
    /^skills\b/i,
    /^technical skills\b/i,
    /^certifications\b/i,
  ];

  let headingIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const candidate = lines[i]?.trim();
    if (!candidate) continue;
    if (headingPatterns.some((pattern) => pattern.test(candidate))) {
      headingIndex = i;
      break;
    }
  }

  if (headingIndex >= 0) {
    const fromHeading = lines.slice(headingIndex).join('\n').trim();
    if (fromHeading.length >= 250) {
      return fromHeading;
    }
  }

  const resumeMarkerIndex = lines.findIndex((line) => /^(resume|cv)\b[:\s-]*/i.test(line.trim()));
  if (resumeMarkerIndex >= 0) {
    const afterMarker = lines.slice(resumeMarkerIndex + 1).join('\n').trim();
    if (afterMarker.length >= 250) {
      return afterMarker;
    }
  }

  const bulletLineCount = lines.filter((line) => /^\s*((?:[-*•])|(?:\d+\.))\s+/.test(line)).length;
  const nonEmptyLineCount = lines.filter((line) => line.trim().length > 0).length;

  if (stripped.length >= 900 && nonEmptyLineCount >= 12 && bulletLineCount >= 6) {
    return stripped;
  }

  return '';
}

function resolveResumeText(params: { emailText: string; resumeText?: string }): string {
  const provided = (params.resumeText ?? '').trim();
  if (provided.length >= 200) return provided;

  const inferred = inferResumeTextFromEmail(params.emailText ?? '');
  if (inferred.length > provided.length) {
    return inferred;
  }

  return provided;
}

function buildFounderIntelSummary(params: {
  jobTitle: string;
  recommendation: ConsensusOutput['recommendation'];
  confidence: number;
  strengths: string[];
  risks: string[];
  evidencePoints: string[];
  requirementGaps: string[];
}): string {
  const evidence = dedupeNonEmpty(params.evidencePoints)
    .slice(0, 4)
    .map((value) => compact(value, 150));

  const strengths = dedupeNonEmpty(params.strengths)
    .slice(0, 4)
    .map((value) => compact(value, 130));

  const risks = dedupeNonEmpty(params.risks)
    .slice(0, 3)
    .map((value) => compact(value, 150));

  const gaps = dedupeNonEmpty(params.requirementGaps)
    .slice(0, 2)
    .map((value) => compact(value, 120));

  const confidenceLabel = params.confidence >= 78
    ? 'high'
    : params.confidence >= 55
      ? 'medium'
      : 'low';

  const decisionWhy = evidence[0] ?? strengths[0] ?? 'Evidence is sparse; treat as a calibration screen.';
  const line1 = compact(
    `Decision: ${params.recommendation} for ${params.jobTitle} (${confidenceLabel} confidence) — ${decisionWhy}`,
    170,
  );

  const evidenceLine = evidence.length >= 2
    ? `Evidence: ${evidence[0]}; ${evidence[1]}`
    : evidence.length === 1
      ? `Evidence: ${evidence[0]}`
      : strengths.length > 0
        ? `Evidence: ${strengths.slice(0, 2).join('; ')}`
        : 'Evidence: Not enough concrete artifacts in the intake to support strong claims.';
  const line2 = compact(evidenceLine, 170);

  const probeTarget = gaps[0] ?? risks[0] ?? '';
  const line3 = compact(
    probeTarget
      ? `Probe: pressure-test "${probeTarget}" with one shipped example, scope, and measurable outcome.`
      : 'Probe: ask for one shipped project end-to-end (constraints, decisions, impact, and what they would change).',
    170,
  );

  return [line1, line2, line3].join('\n');
}

function recommendationFromScore(score: number): ConsensusOutput['recommendation'] {
  if (score >= 85) return 'Strong Hire';
  if (score >= 75) return 'Hire';
  if (score >= 65) return 'Leaning Hire';
  if (score >= 55) return 'Leaning No-Hire';
  return 'No-Hire';
}

function buildFallbackRequirementChecks(params: {
  requirements: string[];
  jobTitle: string;
  evidenceText: string;
}) {
  const trimmedEvidence = compact(params.evidenceText || 'Insufficient structured evidence.', 240);
  const requirements = params.requirements.length > 0
    ? params.requirements
    : [
        `Core capability alignment for ${params.jobTitle}`,
        'Communication and collaboration signal',
        'Role-relevant execution evidence',
      ];

  return requirements.slice(0, 6).map((requirement) => ({
    requirement,
    met: false,
    evidence: trimmedEvidence,
  }));
}

function buildFallbackAgentAssessment(params: {
  agent: ConsensusAgent;
  turn: number;
  baselineScore: number;
  evidenceText: string;
  requirements: string[];
  jobTitle: string;
}): EvaluatorAssessment {
  const turnAdjustment = params.turn > 1 ? 2 : 0;

  if (params.agent === 'technical') {
    return {
      score: Math.max(0, Math.min(100, params.baselineScore + 4 - turnAdjustment)),
      confidence: 52,
      rationale: 'Fallback technical estimate from available candidate evidence and role context.',
      evidencePoints: [
        compact(params.evidenceText || 'No technical evidence supplied.', 140),
        `Role context considered: ${params.jobTitle}`,
      ],
      adjustmentNote:
        params.turn > 1 ? 'Adjusted slightly after cross-evaluator review in fallback mode.' : undefined,
    };
  }

  if (params.agent === 'social') {
    return {
      score: Math.max(0, Math.min(100, params.baselineScore - 2 + turnAdjustment)),
      confidence: 48,
      rationale: 'Fallback social/tone estimate from communication clarity in provided text.',
      evidencePoints: [
        compact(params.evidenceText || 'No communication evidence supplied.', 140),
        'Assessed for professionalism and motivation signal only.',
      ],
      adjustmentNote:
        params.turn > 1 ? 'Adjusted after considering technical and ATS fallback notes.' : undefined,
    };
  }

  return {
    score: Math.max(0, Math.min(100, params.baselineScore + turnAdjustment)),
    confidence: 50,
    rationale: 'Fallback ATS objective match estimate due to structured generation failure.',
    evidencePoints: [
      compact(params.evidenceText || 'No objective evidence supplied.', 140),
      `Requirement count considered: ${params.requirements.length}`,
    ],
    adjustmentNote:
      params.turn > 1 ? 'Adjusted after peer review in fallback mode.' : undefined,
    requirementChecks: buildFallbackRequirementChecks({
      requirements: params.requirements,
      jobTitle: params.jobTitle,
      evidenceText: params.evidenceText,
    }),
  };
}

function toTurnSnapshot(params: {
  agent: ConsensusAgent;
  turn: number;
  assessment: EvaluatorAssessment;
}): ConsensusTurnSnapshot {
  return {
    agent: params.agent,
    turn: params.turn,
    score: params.assessment.score,
    confidence: params.assessment.confidence,
    rationale: compact(params.assessment.rationale, 320),
    keyEvidence: params.assessment.evidencePoints.slice(0, 4).map((item) => compact(item, 220)),
    adjustmentNote: params.assessment.adjustmentNote
      ? compact(params.assessment.adjustmentNote, 220)
      : undefined,
  };
}

function getLatestSnapshotByAgent(
  snapshots: ConsensusTurnSnapshot[],
  agent: ConsensusAgent,
): ConsensusTurnSnapshot {
  const found = [...snapshots]
    .reverse()
    .find((snapshot) => snapshot.agent === agent);

  if (!found) {
    throw new Error(`Missing snapshot for agent ${agent}`);
  }

  return found;
}

async function runEvaluatorTurn(params: {
  agent: ConsensusAgent;
  turn: number;
  maxTurns: number;
  context: CandidateConsensusContext;
  snapshots: ConsensusTurnSnapshot[];
  baselineScore: number;
}): Promise<{ assessment: EvaluatorAssessment; fallbackUsed: boolean }> {
  const prompt =
    params.agent === 'technical'
      ? buildTechnicalEvaluatorPrompt({
          context: params.context,
          turn: params.turn,
          maxTurns: params.maxTurns,
          snapshots: params.snapshots,
        })
      : params.agent === 'social'
        ? buildSocialEvaluatorPrompt({
            context: params.context,
            turn: params.turn,
            maxTurns: params.maxTurns,
            snapshots: params.snapshots,
          })
        : buildAtsEvaluatorPrompt({
            context: params.context,
            turn: params.turn,
            maxTurns: params.maxTurns,
            snapshots: params.snapshots,
          });

  try {
    const { object } = await generateObject({
      model: nim.chatModel(nimChatModelId),
      schema: evaluatorAssessmentSchema,
      temperature: 0.1,
      prompt,
    });

    if (params.agent === 'ats_objective' && (!object.requirementChecks || object.requirementChecks.length === 0)) {
      return {
        assessment: {
          ...object,
          requirementChecks: buildFallbackRequirementChecks({
            requirements: params.context.requirements,
            jobTitle: params.context.jobTitle,
            evidenceText: `${params.context.emailText}\n${params.context.resumeText}`,
          }),
        },
        fallbackUsed: true,
      };
    }

    return {
      assessment: object,
      fallbackUsed: false,
    };
  } catch {
    return {
      assessment: buildFallbackAgentAssessment({
        agent: params.agent,
        turn: params.turn,
        baselineScore: params.baselineScore,
        evidenceText: `${params.context.emailText}\n${params.context.resumeText}`,
        requirements: params.context.requirements,
        jobTitle: params.context.jobTitle,
      }),
      fallbackUsed: true,
    };
  }
}

async function runConsensus(params: {
  context: CandidateConsensusContext;
  turns: number;
  weightedBaselineScore: number;
  finalSnapshots: ConsensusTurnSnapshot[];
}): Promise<{ consensus: ConsensusOutput; fallbackUsed: boolean }> {
  const prompt = buildConsensusPrompt({
    context: params.context,
    turns: params.turns,
    weightedBaselineScore: params.weightedBaselineScore,
    weights: {
      technical: AGENT_WEIGHTS.technical,
      social: AGENT_WEIGHTS.social,
      atsObjective: AGENT_WEIGHTS.atsObjective,
    },
    finalSnapshots: params.finalSnapshots,
  });

  try {
    const { object } = await generateObject({
      model: nim.chatModel(nimChatModelId),
      schema: consensusOutputSchema,
      temperature: 0.1,
      prompt,
    });

    return {
      consensus: object,
      fallbackUsed: false,
    };
  } catch {
    const fallbackScore = params.weightedBaselineScore;

    return {
      consensus: {
        finalScore: fallbackScore,
        confidence: 50,
        recommendation: recommendationFromScore(fallbackScore),
        rationale: 'Fallback consensus generated from weighted evaluator scores due to structured consensus failure.',
        strengths: [
          'Technical and objective signals were considered in weighted scoring.',
          'Scoring reflects multi-evaluator review context.',
        ],
        risks: ['Consensus generation fallback was used; review details manually before final decisions.'],
        nextSteps: [
          'Run structured interview focused on requirement gaps.',
          'Validate core technical claims with practical questions.',
          'Confirm motivation and collaboration expectations explicitly.',
        ],
        disagreements: ['Potential disagreement hidden due to fallback consensus mode.'],
      },
      fallbackUsed: true,
    };
  }
}

export const runMultiAgentCandidateScoreTool = tool({
  description:
    'Run a 3-evaluator candidate scoring pass (technical, social tone/eagerness, ATS objective), compute consensus, and persist candidate score outputs. Supports low-latency automation mode.',
  inputSchema: multiAgentScoreInputSchema,
  execute: async (input) => {
    const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;
    const resolvedAutomationMode = input.automationMode === true;
    const resolvedTurns = resolvedAutomationMode ? AUTOMATION_FAST_TURNS : input.turns;
    const resolvedMaxEvidenceChars = resolvedAutomationMode
      ? Math.min(input.maxEvidenceChars, AUTOMATION_FAST_MAX_EVIDENCE_CHARS)
      : input.maxEvidenceChars;

    if (!actorUserId) {
      return {
        check: 'run_multi_agent_candidate_score',
        status: 'error' as const,
        message: 'Unauthorized: missing actor identity for multi-agent candidate scoring.',
      };
    }

    const [candidate] = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        contactEmail: candidates.contactEmail,
        jobId: candidates.jobId,
        organizationId: candidates.organizationId,
        stage: candidates.stage,
        summary: candidates.summary,
        score: candidates.score,
      })
      .from(candidates)
      .where(eq(candidates.id, input.candidateId))
      .limit(1);

    if (!candidate) {
      return {
        check: 'run_multi_agent_candidate_score',
        status: 'error' as const,
        message: `Candidate ${input.candidateId} not found.`,
      };
    }

    const canView = await canViewCandidate(actorUserId, candidate.id);
    if (!canView) {
      return {
        check: 'run_multi_agent_candidate_score',
        status: 'error' as const,
        message: `Forbidden: no candidate visibility access for ${candidate.id}.`,
      };
    }

    const resolvedJobId = input.jobId ?? candidate.jobId;
    const [job] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
      })
      .from(jobs)
      .where(eq(jobs.id, resolvedJobId))
      .limit(1);

    if (!job) {
      return {
        check: 'run_multi_agent_candidate_score',
        status: 'error' as const,
        message: `Job ${resolvedJobId} not found.`,
      };
    }

    const [applicationRow] = await db
      .select({
        id: applications.id,
        stage: applications.stage,
      })
      .from(applications)
      .where(and(eq(applications.candidateId, candidate.id), eq(applications.jobId, job.id)))
      .limit(1);

    const requirements = dedupeNonEmpty(input.requirements ?? []);
    const resolvedEmailText = input.emailText ?? '';
    const resolvedResumeText = resolveResumeText({
      emailText: resolvedEmailText,
      resumeText: input.resumeText,
    });

    const rawEvidence = [candidate.summary ?? '', resolvedEmailText, resolvedResumeText, input.externalContext ?? '']
      .filter((value) => value.trim().length > 0)
      .join('\n\n');

    const context: CandidateConsensusContext = {
      candidateName: candidate.name,
      candidateEmail: candidate.contactEmail,
      jobTitle: job.title,
      requirements,
      emailText: truncateForModel(resolvedEmailText, resolvedMaxEvidenceChars),
      resumeText: truncateForModel(resolvedResumeText, resolvedMaxEvidenceChars),
      additionalEvidence: truncateForModel(rawEvidence, resolvedMaxEvidenceChars),
    };

    const baselineScore = candidate.score ?? 68;
    const snapshots: ConsensusTurnSnapshot[] = [];
    let latestAtsRequirementChecks: Array<z.infer<typeof candidateQualificationCheckSchema>> | null = null;
    let fallbackUsed = false;

    if (resolvedAutomationMode) {
      fallbackUsed = true;
      const automationEvidence = `${context.resumeText}\n${context.emailText}\n${context.additionalEvidence}`.trim();

      for (const agent of AGENTS) {
        const assessment = buildFallbackAgentAssessment({
          agent,
          turn: resolvedTurns,
          baselineScore,
          evidenceText: automationEvidence,
          requirements,
          jobTitle: job.title,
        });

        snapshots.push(toTurnSnapshot({
          agent,
          turn: resolvedTurns,
          assessment,
        }));

        if (agent === 'ats_objective') {
          latestAtsRequirementChecks =
            assessment.requirementChecks ??
            buildFallbackRequirementChecks({
              requirements,
              jobTitle: job.title,
              evidenceText: `${context.emailText}\n${context.resumeText}`,
            });
        }
      }
    } else {
      for (let turn = 1; turn <= resolvedTurns; turn += 1) {
        for (const agent of AGENTS) {
          const turnResult = await runEvaluatorTurn({
            agent,
            turn,
            maxTurns: resolvedTurns,
            context,
            snapshots,
            baselineScore,
          });

          if (turnResult.fallbackUsed) {
            fallbackUsed = true;
          }

          snapshots.push(toTurnSnapshot({
            agent,
            turn,
            assessment: turnResult.assessment,
          }));

          if (agent === 'ats_objective') {
            latestAtsRequirementChecks =
              turnResult.assessment.requirementChecks ??
              buildFallbackRequirementChecks({
                requirements,
                jobTitle: job.title,
                evidenceText: `${context.emailText}\n${context.resumeText}`,
              });
          }
        }
      }
    }

    const technicalFinal = getLatestSnapshotByAgent(snapshots, 'technical');
    const socialFinal = getLatestSnapshotByAgent(snapshots, 'social');
    const atsFinal = getLatestSnapshotByAgent(snapshots, 'ats_objective');

    const weightedBaselineScore = Math.round(
      technicalFinal.score * AGENT_WEIGHTS.technical +
        socialFinal.score * AGENT_WEIGHTS.social +
        atsFinal.score * AGENT_WEIGHTS.atsObjective,
    );

    let consensusResult: { consensus: ConsensusOutput; fallbackUsed: boolean };

    if (resolvedAutomationMode) {
      const automationScore = weightedBaselineScore;
      const automationConfidence = Math.max(
        0,
        Math.min(100, Math.round((technicalFinal.confidence + socialFinal.confidence + atsFinal.confidence) / 3)),
      );
      const automationStrengths = dedupeNonEmpty([
        technicalFinal.keyEvidence[0] ?? 'Technical evidence was reviewed.',
        socialFinal.keyEvidence[0] ?? 'Communication signal was reviewed.',
        atsFinal.keyEvidence[0] ?? 'Requirement alignment was reviewed.',
      ]).slice(0, 6);

      consensusResult = {
        consensus: {
          finalScore: automationScore,
          confidence: automationConfidence,
          recommendation: recommendationFromScore(automationScore),
          rationale: 'Initial screen based on the available email + resume evidence. Confirm key requirements in a live screen.',
          strengths: automationStrengths.length >= 2
            ? automationStrengths
            : [
                'Candidate evidence was reviewed for role alignment.',
                'Multi-agent dimensions were still represented in scoring.',
              ],
          risks: [
            'Evidence may be incomplete; verify top requirements in the first screen.',
            'Use a structured interview to validate depth and ownership.',
          ],
          nextSteps: [
            'Validate top requirements in a structured interview.',
            'Pressure-test technical depth with practical scenarios.',
            'If still promising, run full scoring before finalizing decisions.',
          ],
          disagreements: [],
        },
        fallbackUsed: true,
      };
    } else {
      consensusResult = await runConsensus({
        context,
        turns: resolvedTurns,
        weightedBaselineScore,
        finalSnapshots: [technicalFinal, socialFinal, atsFinal],
      });
    }

    if (consensusResult.fallbackUsed) {
      fallbackUsed = true;
    }

    const consensusScore = Math.max(
      weightedBaselineScore - 15,
      Math.min(weightedBaselineScore + 15, consensusResult.consensus.finalScore),
    );

    const finalConfidence = Math.max(0, Math.min(100, consensusResult.consensus.confidence));

    const scoreBreakdown: Array<z.infer<typeof candidateScoreBreakdownItemSchema>> = [
      {
        dimension: 'Technical Fit',
        score: technicalFinal.score,
        reasoning: technicalFinal.rationale,
      },
      {
        dimension: 'Social Tone and Eagerness',
        score: socialFinal.score,
        reasoning: socialFinal.rationale,
      },
      {
        dimension: 'ATS Objective Match',
        score: atsFinal.score,
        reasoning: atsFinal.rationale,
      },
      {
        dimension: 'Consensus Alignment',
        score: consensusScore,
        reasoning: compact(consensusResult.consensus.rationale, 320),
      },
    ];

    const qualificationChecks =
      latestAtsRequirementChecks ??
      buildFallbackRequirementChecks({
        requirements,
        jobTitle: job.title,
        evidenceText: `${context.emailText}\n${context.resumeText}`,
      });

    const summary = buildFounderIntelSummary({
      jobTitle: job.title,
      recommendation: consensusResult.consensus.recommendation,
      confidence: finalConfidence,
      strengths: consensusResult.consensus.strengths,
      risks: consensusResult.consensus.risks,
      evidencePoints: [technicalFinal, socialFinal, atsFinal].flatMap((snapshot) => snapshot.keyEvidence),
      requirementGaps: qualificationChecks.filter((check) => !check.met).map((check) => check.requirement),
    });

    const candidateStage = candidate.stage === 'applied' ? 'reviewed' : candidate.stage;
    const applicationStage = applicationRow?.stage === 'applied' ? 'reviewed' : applicationRow?.stage;
    const updatedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(candidates)
        .set({
          stage: candidateStage,
          objectiveScore: consensusScore,
          score: consensusScore,
          intelConfidence: finalConfidence,
          scoreBreakdown,
          qualificationChecks,
          summary,
          updatedAt,
        })
        .where(eq(candidates.id, candidate.id));

      if (applicationRow) {
        await tx
          .update(applications)
          .set({
            stage: applicationStage,
            updatedAt,
          })
          .where(eq(applications.id, applicationRow.id));
      }

      await tx.insert(auditLogs).values({
        organizationId: input.organizationId ?? candidate.organizationId ?? null,
        actorType: 'agent',
        actorId: 'run_multi_agent_candidate_score',
        actorDisplayName: 'Consensus Scoring Agent',
        action: 'candidate.multi_agent_score.generated',
        resourceType: 'candidate',
        resourceId: candidate.id,
        metadata: {
          actorUserId,
          candidateId: candidate.id,
          jobId: job.id,
          turns: resolvedTurns,
          automationMode: resolvedAutomationMode,
          maxEvidenceChars: resolvedMaxEvidenceChars,
          weights: AGENT_WEIGHTS,
          weightedBaselineScore,
          finalScore: consensusScore,
          finalConfidence,
          fallbackUsed,
          recommendation: consensusResult.consensus.recommendation,
          agentScores: {
            technical: technicalFinal.score,
            social: socialFinal.score,
            atsObjective: atsFinal.score,
          },
          turnSnapshots: snapshots.map((snapshot) => ({
            agent: snapshot.agent,
            turn: snapshot.turn,
            score: snapshot.score,
            confidence: snapshot.confidence,
            adjustmentNote: snapshot.adjustmentNote ?? null,
          })),
        },
        result: 'success',
      });
    });

    return {
      check: 'run_multi_agent_candidate_score',
      status: 'success' as const,
      candidateId: candidate.id,
      jobId: job.id,
      stage: candidateStage,
      turns: resolvedTurns,
      automationMode: resolvedAutomationMode,
      maxEvidenceChars: resolvedMaxEvidenceChars,
      weightedBaselineScore,
      fallbackUsed,
      weights: {
        technical: AGENT_WEIGHTS.technical,
        social: AGENT_WEIGHTS.social,
        atsObjective: AGENT_WEIGHTS.atsObjective,
      },
      agentScores: {
        technical: technicalFinal.score,
        social: socialFinal.score,
        atsObjective: atsFinal.score,
      },
      consensus: {
        finalScore: consensusScore,
        confidence: finalConfidence,
        recommendation: consensusResult.consensus.recommendation,
        rationale: consensusResult.consensus.rationale,
        strengths: consensusResult.consensus.strengths,
        risks: consensusResult.consensus.risks,
        nextSteps: consensusResult.consensus.nextSteps,
        disagreements: consensusResult.consensus.disagreements,
      },
    };
  },
});
