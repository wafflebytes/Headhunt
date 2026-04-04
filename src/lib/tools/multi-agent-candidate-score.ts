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
  turns: z.number().int().min(2).max(3).default(3),
  maxEvidenceChars: z.number().int().min(2000).max(24000).default(9000),
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
      `Requirement count considered: ${params.requirements.length}`,
      compact(params.evidenceText || 'No objective evidence supplied.', 140),
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
    'Run a 3-evaluator candidate scoring pass (technical, social tone/eagerness, ATS objective) over 2-3 turns, compute consensus, and persist candidate score outputs.',
  inputSchema: multiAgentScoreInputSchema,
  execute: async (input) => {
    const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

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
    const rawEvidence = [
      candidate.summary ?? '',
      input.emailText ?? '',
      input.resumeText ?? '',
      input.externalContext ?? '',
    ]
      .filter((value) => value.trim().length > 0)
      .join('\n\n');

    const context: CandidateConsensusContext = {
      candidateName: candidate.name,
      candidateEmail: candidate.contactEmail,
      jobTitle: job.title,
      requirements,
      emailText: truncateForModel(input.emailText ?? '', input.maxEvidenceChars),
      resumeText: truncateForModel(input.resumeText ?? '', input.maxEvidenceChars),
      additionalEvidence: truncateForModel(rawEvidence, input.maxEvidenceChars),
    };

    const baselineScore = candidate.score ?? 68;
    const snapshots: ConsensusTurnSnapshot[] = [];
    let latestAtsRequirementChecks: Array<z.infer<typeof candidateQualificationCheckSchema>> | null = null;
    let fallbackUsed = false;

    for (let turn = 1; turn <= input.turns; turn += 1) {
      for (const agent of AGENTS) {
        const turnResult = await runEvaluatorTurn({
          agent,
          turn,
          maxTurns: input.turns,
          context,
          snapshots,
          baselineScore,
        });

        if (turnResult.fallbackUsed) {
          fallbackUsed = true;
        }

        snapshots.push({
          agent,
          turn,
          score: turnResult.assessment.score,
          confidence: turnResult.assessment.confidence,
          rationale: compact(turnResult.assessment.rationale, 320),
          keyEvidence: turnResult.assessment.evidencePoints.slice(0, 4).map((item) => compact(item, 220)),
          adjustmentNote: turnResult.assessment.adjustmentNote
            ? compact(turnResult.assessment.adjustmentNote, 220)
            : undefined,
        });

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

    const technicalFinal = getLatestSnapshotByAgent(snapshots, 'technical');
    const socialFinal = getLatestSnapshotByAgent(snapshots, 'social');
    const atsFinal = getLatestSnapshotByAgent(snapshots, 'ats_objective');

    const weightedBaselineScore = Math.round(
      technicalFinal.score * AGENT_WEIGHTS.technical +
        socialFinal.score * AGENT_WEIGHTS.social +
        atsFinal.score * AGENT_WEIGHTS.atsObjective,
    );

    const consensusResult = await runConsensus({
      context,
      turns: input.turns,
      weightedBaselineScore,
      finalSnapshots: [technicalFinal, socialFinal, atsFinal],
    });

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

    const summary = compact(
      [
        consensusResult.consensus.rationale,
        `Recommendation: ${consensusResult.consensus.recommendation}`,
        `Strengths: ${consensusResult.consensus.strengths.join('; ')}`,
        `Risks: ${consensusResult.consensus.risks.join('; ')}`,
      ].join(' '),
      1000,
    );

    const candidateStage = candidate.stage === 'applied' ? 'reviewed' : candidate.stage;
    const applicationStage = applicationRow?.stage === 'applied' ? 'reviewed' : applicationRow?.stage;
    const updatedAt = new Date();

    await db.transaction(async (tx: typeof db) => {
      await tx
        .update(candidates)
        .set({
          stage: candidateStage,
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
          turns: input.turns,
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
      turns: input.turns,
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
