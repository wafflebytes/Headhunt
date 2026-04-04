import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

type FixtureKey = 'application' | 'scheduling_reply' | 'irrelevant';

type Fixture = {
  key: FixtureKey;
  candidateName: string;
  candidateEmailBase: string;
  subject: string;
  body: string;
};

type CliArgs = {
  baseUrl: string;
  cookie?: string;
  cookieFile?: string;
  organizationId: string;
  jobId: string;
  fixture: FixtureKey | 'all';
  checkIdempotency: boolean;
  verbose: boolean;
};

const DEFAULT_COOKIE_FILE_PATH = path.resolve(process.cwd(), 'product/cookie.md');
const LEGACY_COOKIE_FILE_PATH = path.resolve(process.cwd(), 'product/cookie');

type IngestResult = {
  fixture: FixtureKey;
  firstAttempt: {
    status: number;
    idempotent: boolean | null;
    candidateId: string | null;
    applicationId: string | null;
  };
  secondAttempt?: {
    status: number;
    idempotent: boolean | null;
    candidateId: string | null;
    applicationId: string | null;
  };
  errors: string[];
};

const FIXTURES: Fixture[] = [
  {
    key: 'application',
    candidateName: 'Maya Patel',
    candidateEmailBase: 'maya.patel.smoke',
    subject: 'Application - Founding Engineer - Maya Patel',
    body: [
      'Hi team,',
      '',
      'I am applying for the Founding Engineer role.',
      'I have 4 years of backend experience in TypeScript and distributed systems.',
      'I have shipped recruiting workflow tooling for startup teams.',
      '',
      'Thanks,',
      'Maya Patel',
    ].join('\n'),
  },
  {
    key: 'scheduling_reply',
    candidateName: 'Julian Kim',
    candidateEmailBase: 'julian.kim.smoke',
    subject: 'Re: Interview availability - Julian Kim',
    body: [
      'Thanks for the invite.',
      'I can do Tuesday 2-5 PM PT or Wednesday 10 AM-1 PM PT.',
      'Please send a Google Meet invite to this email.',
    ].join('\n'),
  },
  {
    key: 'irrelevant',
    candidateName: 'Invoice Bot',
    candidateEmailBase: 'invoice.bot.smoke',
    subject: 'Invoice reminder',
    body: 'Please review your monthly SaaS invoice. Payment is due in 3 days.',
  },
];

function printUsage() {
  console.log(`Usage:
  npm run smoke:ingest-endpoint -- [options]

Options:
  --base-url <url>            Base URL for your app (default: http://localhost:3000)
  --cookie <cookieHeader>     Full Cookie header value for an authenticated browser session
  --cookie-file <path>        Path to cookie file (default: product/cookie.md)
  --organization-id <id>      Organization id (default: org_demo_headhunt)
  --job-id <id>               Job id (default: job_demo_founding_engineer)
  --fixture <name>            application | scheduling_reply | irrelevant | all (default: application)
  --no-idempotency-check      Skip duplicate replay idempotency assertion
  --verbose                   Print full response summary
  --help                      Show this help

Auth cookie source:
- Use --cookie OR set HEADHUNT_SMOKE_COOKIE in your shell.
- Or point to a cookie file via --cookie-file / HEADHUNT_SMOKE_COOKIE_FILE (supports "session 0 : ..." + "session 1 : ..." OR "__session=...").
- The value must be the full Cookie header string copied from an authenticated request to your app.`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseUrl: process.env.HEADHUNT_SMOKE_BASE_URL ?? 'http://localhost:3000',
    cookie: process.env.HEADHUNT_SMOKE_COOKIE,
    cookieFile: process.env.HEADHUNT_SMOKE_COOKIE_FILE,
    organizationId: process.env.HEADHUNT_SMOKE_ORG_ID ?? 'org_demo_headhunt',
    jobId: process.env.HEADHUNT_SMOKE_JOB_ID ?? 'job_demo_founding_engineer',
    fixture: 'application',
    checkIdempotency: true,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--verbose') {
      args.verbose = true;
      continue;
    }

    if (arg === '--no-idempotency-check') {
      args.checkIdempotency = false;
      continue;
    }

    if (arg === '--base-url') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --base-url');
      }

      args.baseUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--cookie') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --cookie');
      }

      args.cookie = next;
      index += 1;
      continue;
    }

    if (arg === '--cookie-file') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --cookie-file');
      }

      args.cookieFile = next;
      index += 1;
      continue;
    }

    if (arg === '--organization-id') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --organization-id');
      }

      args.organizationId = next;
      index += 1;
      continue;
    }

    if (arg === '--job-id') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --job-id');
      }

      args.jobId = next;
      index += 1;
      continue;
    }

    if (arg === '--fixture') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --fixture');
      }

      if (!['application', 'scheduling_reply', 'irrelevant', 'all'].includes(next)) {
        throw new Error(`Invalid --fixture value: ${next}`);
      }

      args.fixture = next as CliArgs['fixture'];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeCookieHeader(rawCookie: string): string {
  const collapsed = rawCookie.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return rawCookie;
  }

  if (/\b__session__0=|\b__session__1=|\b__session=/i.test(collapsed)) {
    return collapsed;
  }

  const session0 = collapsed.match(/\bsession\s*0\s*:\s*([^\s;]+)/i)?.[1];
  const session1 = collapsed.match(/\bsession\s*1\s*:\s*([^\s;]+)/i)?.[1];
  const singleSession = collapsed.match(/\b(?:__session|session)\b\s*[:=]\s*([^\s;]+)/i)?.[1];

  if (!session0 && !session1 && !singleSession) {
    if (collapsed.startsWith('eyJ')) {
      return `__session=${collapsed}`;
    }

    return rawCookie.trim();
  }

  const normalizedParts: string[] = [];
  if (session0) normalizedParts.push(`__session__0=${session0}`);
  if (session1) normalizedParts.push(`__session__1=${session1}`);

  if (normalizedParts.length === 0 && singleSession) {
    normalizedParts.push(`__session=${singleSession}`);
  }

  return normalizedParts.join('; ');
}

function parseCookieFromText(rawText: string): string | null {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  const session0 = normalized.match(/\bsession\s*0\s*:\s*([^\s;]+)/i)?.[1];
  const session1 = normalized.match(/\bsession\s*1\s*:\s*([^\s;]+)/i)?.[1];
  const singleSession = normalized.match(/\b(?:__session|session)\b\s*[:=]\s*([^\s;]+)/i)?.[1];

  if (session0 || session1) {
    const segments: string[] = [];
    if (session0) segments.push(`__session__0=${session0}`);
    if (session1) segments.push(`__session__1=${session1}`);
    return segments.join('; ');
  }

  if (singleSession) {
    return `__session=${singleSession}`;
  }

  const firstNonCommentLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));

  if (!firstNonCommentLine) {
    return null;
  }

  const normalizedHeader = normalizeCookieHeader(firstNonCommentLine);
  return normalizedHeader || null;
}

async function resolveCookieHeader(args: CliArgs): Promise<string> {
  const inlineCookie = normalizeCookieHeader((args.cookie ?? '').trim());
  if (inlineCookie) {
    return inlineCookie;
  }

  const candidatePaths = [
    args.cookieFile,
    process.env.HEADHUNT_SMOKE_COOKIE_FILE,
    DEFAULT_COOKIE_FILE_PATH,
    LEGACY_COOKIE_FILE_PATH,
  ]
    .filter((item): item is string => Boolean(item && item.trim()))
    .map((item) => path.resolve(item));

  const visited = new Set<string>();

  for (const candidatePath of candidatePaths) {
    if (visited.has(candidatePath)) {
      continue;
    }

    visited.add(candidatePath);

    try {
      const fileContents = await fs.readFile(candidatePath, 'utf8');
      const parsedCookie = parseCookieFromText(fileContents);
      if (parsedCookie) {
        return parsedCookie;
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        continue;
      }

      throw new Error(`Unable to read cookie file at ${candidatePath}: ${nodeError.message ?? 'unknown error'}`);
    }
  }

  throw new Error(
    `Missing auth cookie. Pass --cookie "<full-cookie-header>", set HEADHUNT_SMOKE_COOKIE, or provide --cookie-file/HEADHUNT_SMOKE_COOKIE_FILE (defaults: ${DEFAULT_COOKIE_FILE_PATH}).`,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function selectFixtures(fixture: CliArgs['fixture']): Fixture[] {
  if (fixture === 'all') {
    return FIXTURES;
  }

  const selected = FIXTURES.find((item) => item.key === fixture);
  if (!selected) {
    throw new Error(`Unknown fixture: ${fixture}`);
  }

  return [selected];
}

function buildRawEmailText(fixture: Fixture): string {
  return `Subject: ${fixture.subject}\n\n${fixture.body}`;
}

function buildPayload(params: {
  fixture: Fixture;
  runId: string;
  sequence: number;
  organizationId: string;
  jobId: string;
}) {
  const sourceId = `msg_smoke_ingest_${params.fixture.key}_${params.runId}_${params.sequence}`;

  return {
    jobId: params.jobId,
    organizationId: params.organizationId,
    candidateName: params.fixture.candidateName,
    candidateEmail: `${params.fixture.candidateEmailBase}+${params.runId}@example.com`,
    rawEmailText: buildRawEmailText(params.fixture),
    source: {
      gmailMessageId: sourceId,
      gmailThreadId: `thread_${sourceId}`,
      receivedAt: new Date().toISOString(),
    },
  };
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text };
  }
}

async function postIngest(params: {
  endpoint: string;
  cookieHeader: string;
  payload: Record<string, unknown>;
}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: params.cookieHeader,
    },
    body: JSON.stringify(params.payload),
  });

  const body = await parseJsonSafely(response);
  return { status: response.status, body };
}

function summarizeAttempt(attempt: { status: number; body: unknown }) {
  const body = asRecord(attempt.body);
  const candidate = asRecord(body?.candidate);
  const application = asRecord(body?.application);

  return {
    status: attempt.status,
    idempotent: asBoolean(body?.idempotent),
    candidateId: asString(candidate?.id),
    applicationId: asString(application?.id),
  };
}

function detectAuthCookieIssue(body: unknown): string | null {
  const asObj = asRecord(body);
  const rawText = asString(asObj?.rawText) ?? '';
  const message = asString(asObj?.message) ?? '';
  const combined = `${rawText}\n${message}`;

  if (!combined.trim()) {
    return null;
  }

  if (/JWEInvalid|JWE Protected Header is invalid/i.test(combined)) {
    return (
      'Detected stale/invalid Auth0 session cookie (JWE decryption failed). ' +
      'Log in again on localhost and refresh product/cookie.md with latest session values (__session or session 0/session 1 format).'
    );
  }

  if (/Unauthorized/i.test(combined)) {
    return (
      'Detected unauthenticated request. Ensure you are logged in on localhost and product/cookie.md contains current session cookies.'
    );
  }

  return null;
}

function assertSuccessfulCreate(result: IngestResult, attemptSummary: ReturnType<typeof summarizeAttempt>) {
  if (attemptSummary.status !== 200) {
    result.errors.push(`first attempt expected HTTP 200, got ${attemptSummary.status}`);
    return;
  }

  if (attemptSummary.idempotent !== false) {
    result.errors.push('first attempt expected idempotent=false for a new source message id');
  }

  if (!attemptSummary.candidateId) {
    result.errors.push('first attempt did not return candidate.id');
  }

  if (!attemptSummary.applicationId) {
    result.errors.push('first attempt did not return application.id');
  }
}

function appendAuthCookieHints(result: IngestResult, attempt: { status: number; body: unknown }) {
  if (attempt.status === 200) {
    return;
  }

  const issue = detectAuthCookieIssue(attempt.body);
  if (issue) {
    result.errors.push(issue);
  }
}

function assertIdempotencyReplay(result: IngestResult, attemptSummary: ReturnType<typeof summarizeAttempt>) {
  if (attemptSummary.status !== 200) {
    result.errors.push(`second attempt expected HTTP 200, got ${attemptSummary.status}`);
    return;
  }

  if (attemptSummary.idempotent !== true) {
    result.errors.push('second attempt expected idempotent=true for duplicate source message id');
  }

  if (!attemptSummary.candidateId) {
    result.errors.push('second attempt did not return candidate.id');
  }

  if (!attemptSummary.applicationId) {
    result.errors.push('second attempt did not return application.id');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cookieHeader = await resolveCookieHeader(args);

  const endpoint = `${args.baseUrl.replace(/\/+$/, '')}/api/candidates/ingest`;
  const selectedFixtures = selectFixtures(args.fixture);
  const runId = Date.now().toString();

  const results: IngestResult[] = [];

  for (const [sequence, fixture] of selectedFixtures.entries()) {
    const payload = buildPayload({
      fixture,
      runId,
      sequence,
      organizationId: args.organizationId,
      jobId: args.jobId,
    });

    const firstAttempt = await postIngest({
      endpoint,
      cookieHeader,
      payload,
    });

    const result: IngestResult = {
      fixture: fixture.key,
      firstAttempt: summarizeAttempt(firstAttempt),
      errors: [],
    };

    appendAuthCookieHints(result, firstAttempt);

    assertSuccessfulCreate(result, result.firstAttempt);

    if (args.checkIdempotency) {
      const secondAttempt = await postIngest({
        endpoint,
        cookieHeader,
        payload,
      });

      result.secondAttempt = summarizeAttempt(secondAttempt);
      appendAuthCookieHints(result, secondAttempt);
      assertIdempotencyReplay(result, result.secondAttempt);
    }

    results.push(result);
  }

  const ok = results.every((result) => result.errors.length === 0);

  const summary = {
    ok,
    endpoint,
    fixtureCount: selectedFixtures.length,
    checkIdempotency: args.checkIdempotency,
    results,
  };

  if (args.verbose || !ok) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          ok: summary.ok,
          endpoint: summary.endpoint,
          fixtureCount: summary.fixtureCount,
          checkIdempotency: summary.checkIdempotency,
          results: summary.results.map((result) => ({
            fixture: result.fixture,
            status: result.firstAttempt.status,
            idempotentReplay: result.secondAttempt?.idempotent ?? null,
          })),
        },
        null,
        2,
      ),
    );
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
