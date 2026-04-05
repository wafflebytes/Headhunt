import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

type GuardrailScenario = {
  name: string;
  handlerType: string;
  payload: Record<string, unknown>;
  expectedMissing: string[];
};

type GuardrailResult = {
  name: string;
  ok: boolean;
  details: {
    check: string | null;
    status: string | null;
    boundary: string | null;
    message: string | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function includesAllMissingKeys(message: string | null, expectedMissing: string[]): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return expectedMissing.every((field) => normalized.includes(field.toLowerCase()));
}

async function main() {
  const { executeAutomationHandler } = await import('../src/lib/automation/queue');

  const scenarios: GuardrailScenario[] = [
    {
      name: 'scheduling.request.send requires candidateId + jobId',
      handlerType: 'scheduling.request.send',
      payload: {},
      expectedMissing: ['candidateId', 'jobId'],
    },
    {
      name: 'scheduling.reply.parse_book requires jobId',
      handlerType: 'scheduling.reply.parse_book',
      payload: { candidateId: 'cand_only' },
      expectedMissing: ['jobId'],
    },
    {
      name: 'offer.draft.create requires candidateId',
      handlerType: 'offer.draft.create',
      payload: { jobId: 'job_only' },
      expectedMissing: ['candidateId'],
    },
    {
      name: 'offer.clearance.poll requires offerId',
      handlerType: 'offer.clearance.poll',
      payload: {},
      expectedMissing: ['offerId'],
    },
  ];

  const results: GuardrailResult[] = [];

  for (const scenario of scenarios) {
    const raw = await executeAutomationHandler({
      handlerType: scenario.handlerType,
      payload: scenario.payload,
    });

    const row = asRecord(raw);
    const check = asNonEmptyString(row?.check) ?? null;
    const status = asNonEmptyString(row?.status) ?? null;
    const boundary = asNonEmptyString(row?.boundary) ?? null;
    const message = asNonEmptyString(row?.message) ?? null;

    const ok =
      check === 'automation_context' &&
      status === 'error' &&
      boundary === 'manual_review_required' &&
      includesAllMissingKeys(message, scenario.expectedMissing);

    results.push({
      name: scenario.name,
      ok,
      details: {
        check,
        status,
        boundary,
        message,
      },
    });
  }

  const failed = results.filter((result) => !result.ok);

  console.log(
    JSON.stringify(
      {
        check: 'smoke_boundary_guards',
        status: failed.length === 0 ? 'success' : 'error',
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        results,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke_boundary_guards failed: ${message}`);
  process.exit(1);
});
