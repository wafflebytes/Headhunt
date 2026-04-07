import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { and, eq, inArray } from 'drizzle-orm';

const DEFAULT_ORG_ID = '1uyfm0n01lahcbob5pqyg';
const DEFAULT_JOB_ID = 'aq75jujxutzn1drceny7n';
const DEFAULT_ACTOR_USER_ID = 'google-oauth2|116423176386819416664';

function resolveArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return null;
  const value = found.slice(prefix.length).trim();
  return value.length > 0 ? value : null;
}

async function main() {
  const organizationId = resolveArg('org') ?? process.env.HEADHUNT_DEMO_ORG_ID ?? DEFAULT_ORG_ID;
  const jobId = resolveArg('job') ?? process.env.HEADHUNT_DEMO_JOB_ID ?? DEFAULT_JOB_ID;
  const actorUserId = resolveArg('actor') ?? process.env.HEADHUNT_DEMO_ACTOR_USER_ID ?? DEFAULT_ACTOR_USER_ID;

  const [{ db }, { candidates }, { automationRuns }] = await Promise.all([
    import('@/lib/db').then((m) => ({ db: m.db })),
    import('@/lib/db/schema/candidates'),
    import('@/lib/db/schema/automation-runs'),
  ]);

  const candidateRows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), eq(candidates.organizationId, organizationId)));

  const candidateIds: string[] = candidateRows.map((row: { id: string }) => row.id);

  let deletedRuns = 0;
  if (candidateIds.length > 0) {
    const deleted = await db
      .delete(automationRuns)
      .where(and(eq(automationRuns.resourceType, 'candidate'), inArray(automationRuns.resourceId, candidateIds)))
      .returning({ id: automationRuns.id });
    deletedRuns = deleted.length;

    await db
      .delete(candidates)
      .where(and(eq(candidates.jobId, jobId), eq(candidates.organizationId, organizationId)));
  }

  const { runIntakeE2E } = await import('@/lib/tools/intake-e2e');
  const { processAutomationQueue } = await import('@/lib/automation/queue');

  const intakeResult = await runIntakeE2E({
    organizationId,
    jobId,
    actorUserId,
    actorDisplayName: 'Demo Founder',
    tokenVaultLoginHint: actorUserId,
    automationMode: true,
    query:
      'in:inbox newer_than:60d -category:promotions -category:social -subject:newsletter -subject:digest -subject:unsubscribe',
    maxResults: 10,
    processLimit: 5,
    candidateLikeOnly: true,
    includeBody: true,
    generateIntel: false,
  } as any);

  const processed = await processAutomationQueue(10);

  console.log(
    JSON.stringify(
      {
        check: 'reset_demo_intake',
        status: 'success',
        organizationId,
        jobId,
        deletedCandidateCount: candidateIds.length,
        deletedAutomationRunCount: deletedRuns,
        intake: intakeResult,
        processed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
