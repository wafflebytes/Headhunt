import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { and, desc, eq } from 'drizzle-orm';

async function main() {
  const candidateId = process.argv[2] || '6xlv1dhyinrree7qr8s6k';

  const [{ db }, { automationRuns }, { candidates }, { runMultiAgentCandidateScoreTool }] = await Promise.all([
    import('@/lib/db').then((m) => ({ db: m.db })),
    import('@/lib/db/schema/automation-runs'),
    import('@/lib/db/schema/candidates'),
    import('@/lib/tools/multi-agent-candidate-score').then((m) => ({ runMultiAgentCandidateScoreTool: m.runMultiAgentCandidateScoreTool })),
  ]);

  const [runRow] = await db
    .select({ id: automationRuns.id, payload: automationRuns.payload })
    .from(automationRuns)
    .where(and(eq(automationRuns.handlerType, 'candidate.score'), eq(automationRuns.resourceType, 'candidate'), eq(automationRuns.resourceId, candidateId)))
    .orderBy(desc(automationRuns.createdAt))
    .limit(1);

  if (!runRow) {
    throw new Error(`No automation_runs row found for candidate ${candidateId}`);
  }

  const payload = (runRow.payload ?? {}) as Record<string, any>;

  const execute = runMultiAgentCandidateScoreTool?.execute;
  if (!execute) {
    throw new Error('runMultiAgentCandidateScoreTool.execute is not available');
  }

  const toolResult = await execute(
    {
      candidateId,
      jobId: payload.jobId,
      organizationId: payload.organizationId,
      actorUserId: payload.actorUserId,
      emailText: payload.emailText,
      resumeText: payload.resumeText,
      externalContext: payload.externalContext,
      requirements: payload.requirements,
      turns: 1,
      maxEvidenceChars: 2500,
      automationMode: true,
    },
    {} as any,
  );

  const [candidateRow] = await db
    .select({
      id: candidates.id,
      summary: candidates.summary,
      score: candidates.score,
      intelConfidence: candidates.intelConfidence,
      updatedAt: candidates.updatedAt,
    })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1);

  console.log(JSON.stringify({ toolResult, candidate: candidateRow }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
