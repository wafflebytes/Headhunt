import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const DEFAULT_COOKIE_FILE_PATH = path.resolve(process.cwd(), 'product/cookie.md');
const LEGACY_COOKIE_FILE_PATH = path.resolve(process.cwd(), 'product/cookie');

type CliArgs = {
  mcpUrl: string;
  appBaseUrl: string;
  accessTokenRoute: string;
  cookie?: string;
  cookieFile?: string;
  bearerToken?: string;
  audience?: string;
  scope?: string;
  organizationId?: string;
  jobId?: string;
  candidateId?: string;
  verbose: boolean;
  skipUnauthorizedCheck: boolean;
};

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

type ToolRun = {
  toolName: string;
  ok: boolean;
  detail: string;
  payload?: Record<string, unknown>;
};

function printUsage() {
  console.log(`Usage:
  npm run smoke:mcp-acceptance -- [options]

Options:
  --mcp-url <url>             MCP stream endpoint (default from MCP_PORT/MCP_ENDPOINT)
  --app-base-url <url>        App base URL for /auth/access-token (default: http://localhost:3000)
  --access-token-route <path> Access token route (default: /auth/access-token)
  --token <bearerToken>       Explicit bearer token (skips cookie -> token exchange)
  --audience <audience>       Audience for /auth/access-token request
  --scope <scope>             Scope for /auth/access-token request
  --cookie <cookieHeader>     Full Cookie header value
  --cookie-file <path>        Cookie file path (default: product/cookie.md, supports __session or session 0/session 1)
  --organization-id <id>      Optional org filter for MCP tool calls
  --job-id <id>               Optional job filter for MCP tool calls
  --candidate-id <id>         Candidate id for get_candidate_detail
  --skip-unauthorized-check   Skip unauthorized-access rejection check
  --verbose                   Print full payload snippets
  --help                      Show this help

Token source priority:
1) --token / MCP_SMOKE_BEARER_TOKEN
2) Cookie-based call to /auth/access-token using --cookie/--cookie-file/HEADHUNT_SMOKE_COOKIE
`);
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function normalizePath(value: string): string {
  if (!value.trim()) {
    return '/auth/access-token';
  }

  return value.startsWith('/') ? value : `/${value}`;
}

function resolveDefaultMcpUrl(): string {
  const explicit =
    process.env.MCP_SERVER_URL?.trim() ??
    process.env.HEADHUNT_MCP_URL?.trim() ??
    process.env.HEADHUNT_MCP_BASE_URL?.trim();

  if (explicit) {
    return explicit;
  }

  const endpoint = (process.env.MCP_ENDPOINT?.trim() || '/mcp').replace(/^([^/])/, '/$1');
  const port = process.env.MCP_PORT?.trim() || '8080';
  const host = process.env.MCP_HOST?.trim() || 'localhost';
  return `http://${host}:${port}${endpoint}`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mcpUrl: resolveDefaultMcpUrl(),
    appBaseUrl: process.env.HEADHUNT_CHAT_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000',
    accessTokenRoute: normalizePath(process.env.NEXT_PUBLIC_ACCESS_TOKEN_ROUTE ?? '/auth/access-token'),
    cookie: process.env.HEADHUNT_SMOKE_COOKIE,
    cookieFile: process.env.HEADHUNT_SMOKE_COOKIE_FILE,
    bearerToken: process.env.MCP_SMOKE_BEARER_TOKEN,
    audience: process.env.MCP_AUTH_AUDIENCE?.trim() || process.env.AUTH0_AUDIENCE?.trim() || undefined,
    scope: process.env.MCP_SMOKE_SCOPE?.trim() || undefined,
    organizationId: process.env.HEADHUNT_SMOKE_ORG_ID?.trim() || undefined,
    jobId: process.env.HEADHUNT_SMOKE_JOB_ID?.trim() || undefined,
    candidateId: process.env.HEADHUNT_SMOKE_CANDIDATE_ID?.trim() || undefined,
    verbose: false,
    skipUnauthorizedCheck: false,
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

    if (arg === '--skip-unauthorized-check') {
      args.skipUnauthorizedCheck = true;
      continue;
    }

    if (arg === '--mcp-url') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --mcp-url');
      args.mcpUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--app-base-url') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --app-base-url');
      args.appBaseUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--access-token-route') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --access-token-route');
      args.accessTokenRoute = normalizePath(next);
      index += 1;
      continue;
    }

    if (arg === '--token') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --token');
      args.bearerToken = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--audience') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --audience');
      args.audience = next;
      index += 1;
      continue;
    }

    if (arg === '--scope') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --scope');
      args.scope = next;
      index += 1;
      continue;
    }

    if (arg === '--cookie') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --cookie');
      args.cookie = next;
      index += 1;
      continue;
    }

    if (arg === '--cookie-file') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --cookie-file');
      args.cookieFile = next;
      index += 1;
      continue;
    }

    if (arg === '--organization-id') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --organization-id');
      args.organizationId = next;
      index += 1;
      continue;
    }

    if (arg === '--job-id') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --job-id');
      args.jobId = next;
      index += 1;
      continue;
    }

    if (arg === '--candidate-id') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --candidate-id');
      args.candidateId = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
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

      throw new Error(
        `Unable to read cookie file at ${candidatePath}: ${nodeError.message ?? 'unknown error'}`,
      );
    }
  }

  throw new Error(
    `Missing auth cookie. Pass --cookie, set HEADHUNT_SMOKE_COOKIE, or provide --cookie-file/HEADHUNT_SMOKE_COOKIE_FILE (default: ${DEFAULT_COOKIE_FILE_PATH}).`,
  );
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function fetchAccessTokenWithCookie(args: CliArgs): Promise<string> {
  const cookieHeader = await resolveCookieHeader(args);

  const url = new URL(args.accessTokenRoute, args.appBaseUrl);
  if (args.audience) {
    url.searchParams.set('audience', args.audience);
  }

  if (args.scope) {
    url.searchParams.set('scope', args.scope);
  }

  const response = await fetch(url, {
    headers: {
      cookie: cookieHeader,
    },
    redirect: 'manual',
  });

  const location = response.headers.get('location');
  if (
    response.status >= 300 &&
    response.status < 400 &&
    location &&
    location.includes('/auth/login')
  ) {
    throw new Error(
      `Access token route redirected to login (${location}). Refresh the authenticated cookie and retry.`,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const payloadRecord = asRecord(payload);
    const errorRecord = asRecord(payloadRecord?.error);
    const payloadMessage =
      asString(errorRecord?.message) ?? asString(payloadRecord?.message) ?? asString(payload) ?? text;

    throw new Error(
      `Failed to fetch access token from ${url.toString()} (status ${response.status}): ${payloadMessage || 'unknown error'}`,
    );
  }

  const token = asString(asRecord(payload)?.token);
  if (!token) {
    throw new Error(
      `Access token response from ${url.toString()} did not include a token field.`,
    );
  }

  return token;
}

async function runUnauthorizedCheck(args: CliArgs): Promise<CheckResult> {
  const client = new Client({ name: 'headhunt-smoke-mcp-unauth', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(args.mcpUrl));

  try {
    await client.connect(transport);
    await client.listTools();

    return {
      name: 'unauthorized_rejected',
      ok: false,
      detail: 'Unexpected success without Authorization header.',
    };
  } catch (error) {
    const message = summarizeError(error);
    const lowered = message.toLowerCase();
    const looksUnauthorized =
      lowered.includes('unauthorized') ||
      lowered.includes('missing bearer token') ||
      lowered.includes('authorization') ||
      lowered.includes('401');

    return {
      name: 'unauthorized_rejected',
      ok: looksUnauthorized,
      detail: looksUnauthorized
        ? `Rejected unauthenticated request: ${message}`
        : `Received non-authorized error (expected auth rejection): ${message}`,
    };
  } finally {
    try {
      await transport.close();
    } catch {
      // Ignore transport close errors in smoke cleanup.
    }
  }
}

function readTextBlocks(result: unknown): string[] {
  const record = asRecord(result);
  const content = asArray(record?.content);
  const texts: string[] = [];

  for (const part of content) {
    const partRecord = asRecord(part);
    if (!partRecord) continue;
    if (partRecord.type !== 'text') continue;

    const text = asString(partRecord.text);
    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

function parseToolJsonPayload(result: unknown, toolName: string): Record<string, unknown> {
  const record = asRecord(result);

  if (record?.isError === true) {
    const textBlocks = readTextBlocks(record);
    const detail = textBlocks[0] || JSON.stringify(record);
    throw new Error(`${toolName} returned isError=true: ${detail}`);
  }

  const textBlocks = readTextBlocks(record);
  if (textBlocks.length === 0) {
    throw new Error(`${toolName} returned no text content blocks.`);
  }

  const firstText = textBlocks[0];
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstText);
  } catch (error) {
    throw new Error(
      `${toolName} returned non-JSON text content: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const payload = asRecord(parsed);
  if (!payload) {
    throw new Error(`${toolName} returned JSON that is not an object payload.`);
  }

  return payload;
}

function validateListJobsPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (!Array.isArray(payload.jobs)) {
    issues.push('jobs must be an array');
  }

  if (asNumber(payload.total) === null) {
    issues.push('total must be a number');
  }

  const firstJob = asRecord(asArray(payload.jobs)[0]);
  if (firstJob) {
    if (!asString(firstJob.id)) issues.push('jobs[0].id must be a string');
    if (!asString(firstJob.title)) issues.push('jobs[0].title must be a string');
    if (!asString(firstJob.status)) issues.push('jobs[0].status must be a string');
  }

  return issues;
}

function validateListPipelinePayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (!Array.isArray(payload.pipeline)) {
    issues.push('pipeline must be an array');
  }

  if (asNumber(payload.total) === null) {
    issues.push('total must be a number');
  }

  if (asNumber(payload.filteredOutByFga) === null) {
    issues.push('filteredOutByFga must be a number');
  }

  const first = asRecord(asArray(payload.pipeline)[0]);
  if (first) {
    if (!asString(first.candidateId)) issues.push('pipeline[0].candidateId must be a string');
    if (!asString(first.jobId)) issues.push('pipeline[0].jobId must be a string');
    if (!asString(first.stage)) issues.push('pipeline[0].stage must be a string');
  }

  return issues;
}

function validateCandidateDetailPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];

  const candidate = asRecord(payload.candidate);
  if (!candidate) {
    issues.push('candidate must be an object');
    return issues;
  }

  if (!asString(candidate.id)) issues.push('candidate.id must be a string');
  if (!asString(candidate.name)) issues.push('candidate.name must be a string');
  if (!asString(candidate.jobId)) issues.push('candidate.jobId must be a string');
  if (!asString(candidate.stage)) issues.push('candidate.stage must be a string');

  const application = payload.application;
  if (application !== null && !asRecord(application)) {
    issues.push('application must be an object or null');
  }

  return issues;
}

function validatePipelineHealthPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];

  if (!Array.isArray(payload.alerts)) {
    issues.push('alerts must be an array');
  }

  if (asNumber(payload.filteredOutByFga) === null) {
    issues.push('filteredOutByFga must be a number');
  }

  if (!asString(payload.generatedAt)) {
    issues.push('generatedAt must be a string');
  }

  if (!Array.isArray(payload.jobs)) {
    issues.push('jobs must be an array');
  }

  if (!asRecord(payload.stageTotals)) {
    issues.push('stageTotals must be an object');
  }

  if (!asRecord(payload.statusTotals)) {
    issues.push('statusTotals must be an object');
  }

  if (asNumber(payload.totalVisibleCandidates) === null) {
    issues.push('totalVisibleCandidates must be a number');
  }

  return issues;
}

async function callToolJson(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({
    arguments: args,
    name: toolName,
  });

  return parseToolJsonPayload(result, toolName);
}

function pickCandidateId(
  explicitCandidateId: string | undefined,
  pipelinePayload: Record<string, unknown>,
): string | null {
  if (explicitCandidateId) {
    return explicitCandidateId;
  }

  const firstPipelineItem = asRecord(asArray(pipelinePayload.pipeline)[0]);
  return asString(firstPipelineItem?.candidateId);
}

async function runAuthenticatedChecks(args: CliArgs, bearerToken: string): Promise<{
  checks: CheckResult[];
  toolRuns: ToolRun[];
}> {
  const checks: CheckResult[] = [];
  const toolRuns: ToolRun[] = [];

  const client = new Client({ name: 'headhunt-smoke-mcp-auth', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(args.mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
  });

  try {
    await client.connect(transport);

    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((tool) => tool.name);
    const requiredTools = [
      'list_jobs',
      'list_pipeline',
      'get_candidate_detail',
      'summarize_pipeline_health',
    ];

    const missingTools = requiredTools.filter((toolName) => !toolNames.includes(toolName));
    checks.push({
      name: 'required_tools_registered',
      ok: missingTools.length === 0,
      detail:
        missingTools.length === 0
          ? `All required tools registered (${requiredTools.join(', ')}).`
          : `Missing required tools: ${missingTools.join(', ')}`,
    });

    const listJobsArgs: Record<string, unknown> = { limit: 20 };
    if (args.organizationId) {
      listJobsArgs.organizationId = args.organizationId;
    }

    const listJobsPayload = await callToolJson(client, 'list_jobs', listJobsArgs);
    const listJobsIssues = validateListJobsPayload(listJobsPayload);
    toolRuns.push({
      toolName: 'list_jobs',
      ok: listJobsIssues.length === 0,
      detail: listJobsIssues.length === 0 ? 'ok' : listJobsIssues.join('; '),
      payload: listJobsPayload,
    });

    const listPipelineArgs: Record<string, unknown> = {
      includeRejected: true,
      limit: 100,
    };
    if (args.organizationId) {
      listPipelineArgs.organizationId = args.organizationId;
    }

    if (args.jobId) {
      listPipelineArgs.jobId = args.jobId;
    }

    const listPipelinePayload = await callToolJson(client, 'list_pipeline', listPipelineArgs);
    const listPipelineIssues = validateListPipelinePayload(listPipelinePayload);
    toolRuns.push({
      toolName: 'list_pipeline',
      ok: listPipelineIssues.length === 0,
      detail: listPipelineIssues.length === 0 ? 'ok' : listPipelineIssues.join('; '),
      payload: listPipelinePayload,
    });

    const candidateId = pickCandidateId(args.candidateId, listPipelinePayload);
    if (!candidateId) {
      toolRuns.push({
        toolName: 'get_candidate_detail',
        ok: false,
        detail:
          'Unable to resolve candidate id (pipeline empty and --candidate-id not provided).',
      });
    } else {
      const candidateDetailPayload = await callToolJson(client, 'get_candidate_detail', {
        candidateId,
      });
      const candidateIssues = validateCandidateDetailPayload(candidateDetailPayload);
      toolRuns.push({
        toolName: 'get_candidate_detail',
        ok: candidateIssues.length === 0,
        detail: candidateIssues.length === 0 ? `ok (candidateId=${candidateId})` : candidateIssues.join('; '),
        payload: candidateDetailPayload,
      });
    }

    const summarizeArgs: Record<string, unknown> = {
      includeRejected: false,
      limit: 500,
    };
    if (args.organizationId) {
      summarizeArgs.organizationId = args.organizationId;
    }

    if (args.jobId) {
      summarizeArgs.jobId = args.jobId;
    }

    const summarizePayload = await callToolJson(client, 'summarize_pipeline_health', summarizeArgs);
    const summarizeIssues = validatePipelineHealthPayload(summarizePayload);
    toolRuns.push({
      toolName: 'summarize_pipeline_health',
      ok: summarizeIssues.length === 0,
      detail: summarizeIssues.length === 0 ? 'ok' : summarizeIssues.join('; '),
      payload: summarizePayload,
    });

    const failedTools = toolRuns.filter((run) => !run.ok);
    checks.push({
      name: 'all_four_tools_successful',
      ok: failedTools.length === 0,
      detail:
        failedTools.length === 0
          ? 'All four MCP tools executed successfully for authenticated user.'
          : `Failed tools: ${failedTools.map((run) => `${run.toolName} (${run.detail})`).join(', ')}`,
    });

    checks.push({
      name: 'payload_stability',
      ok: failedTools.length === 0,
      detail:
        failedTools.length === 0
          ? 'Tool responses produced stable JSON payloads with expected top-level fields.'
          : 'Payload stability check failed because one or more tool schema checks failed.',
    });

    return { checks, toolRuns };
  } finally {
    try {
      await transport.close();
    } catch {
      // Ignore transport close errors in smoke cleanup.
    }
  }
}

function printCheckResult(check: CheckResult) {
  const marker = check.ok ? '[PASS]' : '[FAIL]';
  console.log(`${marker} ${check.name}: ${check.detail}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`MCP endpoint: ${args.mcpUrl}`);
  console.log(`App base URL: ${args.appBaseUrl}`);

  const checks: CheckResult[] = [];

  if (!args.skipUnauthorizedCheck) {
    const unauthorizedCheck = await runUnauthorizedCheck(args);
    checks.push(unauthorizedCheck);
    printCheckResult(unauthorizedCheck);
  } else {
    checks.push({
      name: 'unauthorized_rejected',
      ok: true,
      detail: 'Skipped by --skip-unauthorized-check.',
    });
  }

  const bearerToken = args.bearerToken?.trim() || (await fetchAccessTokenWithCookie(args));
  const authResult = await runAuthenticatedChecks(args, bearerToken);

  for (const check of authResult.checks) {
    checks.push(check);
    printCheckResult(check);
  }

  console.log('\nTool execution summary:');
  for (const toolRun of authResult.toolRuns) {
    const marker = toolRun.ok ? '[PASS]' : '[FAIL]';
    console.log(`${marker} ${toolRun.toolName}: ${toolRun.detail}`);
    if (args.verbose && toolRun.payload) {
      console.log(JSON.stringify(toolRun.payload, null, 2));
    }
  }

  const failedChecks = checks.filter((check) => !check.ok);
  const report = {
    checks,
    mcpUrl: args.mcpUrl,
    ok: failedChecks.length === 0,
    timestamp: new Date().toISOString(),
    tools: authResult.toolRuns.map((run) => ({
      detail: run.detail,
      ok: run.ok,
      toolName: run.toolName,
    })),
  };

  console.log('\nMCP_ACCEPTANCE_JSON ' + JSON.stringify(report));

  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('MCP acceptance smoke failed');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});