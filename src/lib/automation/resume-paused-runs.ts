import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { automationRuns } from '@/lib/db/schema/automation-runs';

type ResumePausedRunsResult = {
  attempted: boolean;
  resumedCount: number;
  resumedRunIds: string[];
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function resumePausedIntakeRunsForActor(userId: string): Promise<ResumePausedRunsResult> {
  const normalizedUserId = asNonEmptyString(userId);
  if (!normalizedUserId) {
    return { attempted: false, resumedCount: 0, resumedRunIds: [] };
  }

  const now = new Date();

  const resumed: Array<{ id: string }> = await db
    .update(automationRuns)
    .set({
      status: 'pending',
      nextAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(automationRuns.status, 'paused_awaiting_reauth'),
        eq(automationRuns.handlerType, 'intake.scan'),
        sql`${automationRuns.payload}->>'actorUserId' = ${normalizedUserId}`,
      ),
    )
    .returning({ id: automationRuns.id });

  return {
    attempted: true,
    resumedCount: resumed.length,
    resumedRunIds: resumed.map((row) => row.id),
  };
}
