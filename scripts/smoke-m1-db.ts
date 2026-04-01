import dotenv from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { applications } from '@/lib/db/schema/applications';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { organizations } from '@/lib/db/schema/organizations';

dotenv.config({ path: '.env.local' });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not defined.');
  }

  const connection = postgres(databaseUrl);
  const db = drizzle(connection);

  const runId = Date.now().toString();
  const organizationId = `org_smoke_${runId}`;
  const jobId = `job_smoke_${runId}`;
  const sourceMessageId = `msg_smoke_${runId}`;

  try {
    const result = await db.transaction(async (tx) => {
      const insertedOrganizations = await tx
        .insert(organizations)
        .values({
          id: organizationId,
          name: `Smoke Org ${runId}`,
        })
        .returning();

      const insertedJobs = await tx
        .insert(jobs)
        .values({
          id: jobId,
          organizationId,
          title: `Smoke Job ${runId}`,
          status: 'active',
        })
        .returning();

      const insertedCandidates = await tx
        .insert(candidates)
        .values({
          organizationId,
          jobId,
          name: 'Smoke Candidate',
          contactEmail: `smoke+${runId}@example.com`,
          summary: 'Inserted by smoke test script.',
          sourceEmailMessageId: sourceMessageId,
          sourceEmailThreadId: `thread_${runId}`,
          stage: 'applied',
        })
        .returning();

      const candidate = insertedCandidates[0];

      await tx
        .insert(applications)
        .values({
          candidateId: candidate.id,
          jobId,
          stage: 'applied',
          status: 'active',
        })
        .returning();

      const candidateRows = await tx
        .select()
        .from(candidates)
        .where(and(eq(candidates.organizationId, organizationId), eq(candidates.jobId, jobId)));

      const stageCounts = await tx
        .select({
          stage: candidates.stage,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(eq(candidates.jobId, jobId))
        .groupBy(candidates.stage);

      return {
        organization: insertedOrganizations[0],
        job: insertedJobs[0],
        candidateCount: candidateRows.length,
        stageCounts,
      };
    });

    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('M1 DB smoke failed');
  console.error(error);
  process.exit(1);
});