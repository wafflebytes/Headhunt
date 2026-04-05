import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import { DefaultChatTransport, generateId, readUIMessageStream, type UIMessage } from 'ai';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Scenario = 'from_start' | 'diagnostics';

const DEFAULT_COOKIE_FILE_PATH = path.resolve(process.cwd(), 'product/cookie.md');
const LEGACY_COOKIE_FILE_PATH = path.resolve(process.cwd(), 'product/cookie');

type CliArgs = {
  baseUrl: string;
  cookie?: string;
  cookieFile?: string;
  threadId: string;
  organizationId?: string;
  jobId?: string;
  candidateId?: string;
  prompts: string[];
  scenario: Scenario;
  continueOnError: boolean;
  verbose: boolean;
  outFile?: string;
};

type PromptStepResult = {
  index: number;
  prompt: string;
  ok: boolean;
  error?: string;
  assistantText?: string;
  qaIssues?: string[];
  toolCalls: Array<{
    toolName: string | null;
    state: string | null;
    hasOutput: boolean;
    outputCheck: string | null;
    outputStatus: string | null;
    outputMode: string | null;
    outputMessage: string | null;
  }>;
};

function containsSerializedPayloadArtifact(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/functions\.[a-zA-Z0-9_]+:\d+\{.*\}/.test(trimmed)) return true;
  if (/<\|tool_call_end\|>|<\|tool_calls_section_end\|>/.test(trimmed)) return true;
  if (/^\s*\[\{['"]type['"]\s*:\s*['"]text['"]/i.test(trimmed)) return true;
  if (/^\s*\[\{\s*"type"\s*:\s*"text"/i.test(trimmed)) return true;

  return false;
}

function detectAssistantQualityIssues(params: {
  assistantText: string;
  toolCalls: PromptStepResult['toolCalls'];
}): string[] {
  const issues: string[] = [];
  const text = params.assistantText.trim();

  if (!text && params.toolCalls.length === 0) {
    issues.push('Assistant returned empty text with no tool output.');
  }

  if (containsSerializedPayloadArtifact(text)) {
    issues.push('Assistant returned serialized payload/tool artifact text.');
  }

  const hasBusinessError = params.toolCalls.some((toolCall) => toolCall.outputStatus === 'error');
  if (hasBusinessError) {
    const soundsSuccessful = /\b(success|successfully|completed|done)\b/i.test(text);
    const mentionsFailure = /\b(error|failed|unable|cannot|can\'t|could\s+not|not\s+found|no\s+scheduled)\b/i.test(text);

    if (soundsSuccessful && !mentionsFailure) {
      issues.push('Assistant text sounds successful while tool output reports error status.');
    }
  }

  return issues;
}

function normalizeTransportError(rawMessage: string): string {
  const message = rawMessage.trim();
  if (!message) {
    return rawMessage;
  }

  const looksLikeHtml = /<!doctype html>|<html/i.test(message);
  const redirectedToLogin =
    /\/auth\/login\?prompt=login/i.test(message) ||
    /this page could not be found\./i.test(message) ||
    /self\.__next_f\.push/i.test(message);

  if (looksLikeHtml && redirectedToLogin) {
    return 'Auth session cookie appears expired or invalid. /api/chat redirected to login. Refresh cookie from an authenticated browser request and retry.';
  }

  if (looksLikeHtml) {
    return 'Received HTML instead of a chat stream from /api/chat. Verify --base-url and --cookie values.';
  }

  return rawMessage;
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

function printUsage() {
  console.log(`Usage:
  npm run smoke:chat-prompts -- [options]

Options:
  --base-url <url>         Base URL for app (default: http://localhost:3000)
  --cookie <cookieHeader>  Full Cookie header for authenticated browser session
  --cookie-file <path>     Path to cookie file (default: product/cookie.md)
  --thread-id <id>         Chat thread id (default: smoke-chat-<timestamp>)
  --scenario <name>        from_start | diagnostics (default: from_start)
  --prompt <text>          Add explicit prompt (can be used multiple times)
  --organization-id <id>   Organization id for scenario prompts
  --job-id <id>            Job id for scenario prompts
  --candidate-id <id>      Candidate id for scheduling/offer prompts
  --halt-on-error          Stop on first prompt failure
  --verbose                Print per-step details and assistant/tool output
  --out <filePath>         Write HHLOG_JSON transcript payload to file
  --help                   Show this help

Auth cookie source:
- Use --cookie OR set HEADHUNT_SMOKE_COOKIE.
- Or point to a cookie file via --cookie-file / HEADHUNT_SMOKE_COOKIE_FILE (supports "session 0 : ..." + "session 1 : ..." OR "__session=...").
- Copy the full Cookie header from an authenticated /api/chat request in your browser devtools.`);
}

function parseArgs(argv: string[]): CliArgs {
  const now = Date.now();

  const args: CliArgs = {
    baseUrl: process.env.HEADHUNT_CHAT_BASE_URL ?? 'http://localhost:3000',
    cookie: process.env.HEADHUNT_SMOKE_COOKIE,
    cookieFile: process.env.HEADHUNT_SMOKE_COOKIE_FILE,
    threadId: `smoke-chat-${now}`,
    organizationId: process.env.HEADHUNT_SMOKE_ORG_ID,
    jobId: process.env.HEADHUNT_SMOKE_JOB_ID,
    candidateId: process.env.HEADHUNT_SMOKE_CANDIDATE_ID,
    prompts: [],
    scenario: 'from_start',
    continueOnError: true,
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

    if (arg === '--halt-on-error') {
      args.continueOnError = false;
      continue;
    }

    if (arg === '--base-url') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --base-url');
      args.baseUrl = next;
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

    if (arg === '--thread-id') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --thread-id');
      args.threadId = next;
      index += 1;
      continue;
    }

    if (arg === '--scenario') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --scenario');
      if (next !== 'from_start' && next !== 'diagnostics') {
        throw new Error(`Invalid scenario: ${next}`);
      }
      args.scenario = next;
      index += 1;
      continue;
    }

    if (arg === '--prompt') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --prompt');
      args.prompts.push(next);
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

    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --out');
      args.outFile = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => {
      const record = asRecord(part);
      if (!record) return '';
      const type = typeof record.type === 'string' ? record.type : '';
      if ((type === 'text' || type === 'output_text') && typeof record.text === 'string') {
        return record.text;
      }

      // Keep backwards compatibility with older stream shapes that omit part.type.
      if (!type && typeof record.text === 'string') {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('')
    .trim();
}

function extractToolParts(message: UIMessage) {
  return message.parts
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => {
      const type = typeof part.type === 'string' ? part.type : '';
      return type.includes('tool') || 'toolName' in part || 'toolCallId' in part || 'input' in part || 'output' in part;
    });
}

function deriveToolName(part: Record<string, unknown>): string | null {
  if (typeof part.toolName === 'string' && part.toolName.trim()) {
    return part.toolName;
  }

  const type = typeof part.type === 'string' ? part.type : '';
  if (type.startsWith('tool-')) {
    const inferred = type.slice('tool-'.length).trim();
    return inferred || null;
  }

  const output = asRecord(part.output);
  if (typeof output?.check === 'string' && output.check.trim()) {
    return output.check;
  }

  return null;
}

function summarizeToolParts(toolParts: Array<Record<string, unknown>>) {
  return toolParts.map((part) => {
    const output = asRecord(part.output);

    return {
      toolName: deriveToolName(part),
      state: typeof part.state === 'string' ? part.state : null,
      hasOutput: part.output !== undefined,
      outputCheck: typeof output?.check === 'string' ? output.check : null,
      outputStatus: typeof output?.status === 'string' ? output.status : null,
      outputMode: typeof output?.mode === 'string' ? output.mode : null,
      outputMessage: typeof output?.message === 'string' ? output.message : null,
    };
  });
}

function findNestedStringByKey(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedStringByKey(item, key);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }

  for (const nestedValue of Object.values(record)) {
    const nested = findNestedStringByKey(nestedValue, key);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function extractCandidateContextFromToolParts(toolParts: Array<Record<string, unknown>>): {
  candidateId?: string;
  jobId?: string;
} {
  let candidateId: string | undefined;
  let jobId: string | undefined;

  for (const toolPart of toolParts) {
    const output = asRecord(toolPart.output);
    if (!output) {
      continue;
    }

    candidateId ??= findNestedStringByKey(output, 'candidateId');
    jobId ??= findNestedStringByKey(output, 'jobId');

    if (candidateId && jobId) {
      break;
    }
  }

  return { candidateId, jobId };
}

function rewritePromptWithRuntimeContext(params: {
  prompt: string;
  candidateId?: string;
  jobId?: string;
}): string {
  let nextPrompt = params.prompt;

  if (params.candidateId && /\bcandidateId\s+/i.test(nextPrompt)) {
    nextPrompt = nextPrompt.replace(/\bcandidateId\s+([^\s]+)/i, `candidateId ${params.candidateId}`);
  }

  if (params.jobId && /\bjobId\s+/i.test(nextPrompt)) {
    nextPrompt = nextPrompt.replace(/\bjobId\s+([^\s]+)/i, `jobId ${params.jobId}`);
  }

  return nextPrompt;
}

function buildScenarioPrompts(args: CliArgs): string[] {
  if (args.scenario === 'diagnostics') {
    return ['run_connection_diagnostics'];
  }

  const prompts = [
    'run_connection_diagnostics',
    `run_intake_e2e with query "in:inbox newer_than:7d" and processLimit 2 and generateIntel true${
      args.organizationId ? ` for organizationId ${args.organizationId}` : ''
    }`,
    `parse_candidate_availability with availabilityText "Tuesday 2-5 PM PT or Wednesday 10 AM-1 PM PT" timezone America/Los_Angeles${
      args.candidateId ? ` and candidateId ${args.candidateId}` : ''
    }`,
  ];

  if (args.candidateId && args.jobId) {
    prompts.push(
      `schedule_interview_slots with candidateId ${args.candidateId} and jobId ${args.jobId}${
        args.organizationId ? ` and organizationId ${args.organizationId}` : ''
      } and durationMinutes 60 and maxSuggestions 3 and timezone America/Los_Angeles`,
    );

    prompts.push('Please book the first slot from your previous suggestion now.');

    prompts.push(
      `send_interview_confirmation with candidateId ${args.candidateId} and jobId ${args.jobId}${
        args.organizationId ? ` and organizationId ${args.organizationId}` : ''
      } and sendMode draft and timezone America/Los_Angeles`,
    );

    prompts.push(
      `draft_offer_letter with candidateId ${args.candidateId} and jobId ${args.jobId}${
        args.organizationId ? ` and organizationId ${args.organizationId}` : ''
      } and baseSalary 185000 and currency USD and startDate 2026-05-01 and equityPercent 0.4 and notes "Terminal smoke draft offer run"`,
    );
  }

  return prompts;
}

async function writeTranscript(outFile: string, args: CliArgs, messages: UIMessage[]) {
  const payload = {
    exportedAt: new Date().toISOString(),
    mode: 'full_session',
    threadId: args.threadId,
    messageCount: messages.length,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: getMessageText(message) || null,
      toolParts: extractToolParts(message),
      raw: message,
    })),
  };

  const output = `HHLOG_JSON\n${JSON.stringify(payload, null, 2)}\n`;
  const resolved = path.resolve(outFile);
  await fs.writeFile(resolved, output, 'utf8');
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cookie = await resolveCookieHeader(args);

  const api = `${args.baseUrl.replace(/\/+$/, '')}/api/chat`;
  const transport = new DefaultChatTransport<UIMessage>({
    api,
    headers: { cookie },
  });

  const messages: UIMessage[] = [];
  const prompts = args.prompts.length > 0 ? args.prompts : buildScenarioPrompts(args);
  const usesScenarioPrompts = args.prompts.length === 0;
  let activeCandidateId = args.candidateId;
  let activeJobId = args.jobId;
  const results: PromptStepResult[] = [];

  for (const [index, rawPrompt] of prompts.entries()) {
    const prompt = usesScenarioPrompts
      ? rewritePromptWithRuntimeContext({
          prompt: rawPrompt,
          candidateId: activeCandidateId,
          jobId: activeJobId,
        })
      : rawPrompt;

    const userMessage: UIMessage = {
      id: generateId(),
      role: 'user',
      parts: [{ type: 'text', text: prompt }],
    };
    messages.push(userMessage);

    try {
      const chunkStream = await transport.sendMessages({
        trigger: 'submit-message',
        chatId: args.threadId,
        messageId: userMessage.id,
        messages,
        abortSignal: undefined,
      });

      let latestMessage: UIMessage | undefined;
      for await (const partial of readUIMessageStream<UIMessage>({ stream: chunkStream })) {
        latestMessage = partial;
      }

      if (!latestMessage) {
        throw new Error('No assistant message returned from chat stream.');
      }

      messages.push(latestMessage);

      const assistantText = getMessageText(latestMessage);
      const toolParts = extractToolParts(latestMessage);
      const toolSummaries = summarizeToolParts(toolParts);
      const discoveredContext = extractCandidateContextFromToolParts(toolParts);
      if (usesScenarioPrompts) {
        if (discoveredContext.candidateId) {
          activeCandidateId = discoveredContext.candidateId;
        }
        if (discoveredContext.jobId) {
          activeJobId = discoveredContext.jobId;
        }
      }

      const qaIssues = detectAssistantQualityIssues({ assistantText, toolCalls: toolSummaries });

      const businessError = toolSummaries.find((toolCall) => toolCall.outputStatus === 'error');

      const isStepOk = !businessError && qaIssues.length === 0;
      const stepError = businessError?.outputMessage ??
        (businessError
          ? `${businessError.toolName ?? 'tool'} returned status=error`
          : qaIssues.length > 0
            ? qaIssues.join(' | ')
            : undefined);

      const stepResult: PromptStepResult = {
        index: index + 1,
        prompt,
        ok: isStepOk,
        error: stepError,
        assistantText,
        qaIssues,
        toolCalls: toolSummaries,
      };
      results.push(stepResult);

      if (args.verbose) {
        console.log(`\n[Step ${stepResult.index}] ${prompt}`);
        console.log(`Assistant: ${assistantText || '(no plain text)'}`);
        if (stepResult.toolCalls.length > 0) {
          console.log(`Tools: ${JSON.stringify(stepResult.toolCalls, null, 2)}`);
        }
        if (stepResult.qaIssues && stepResult.qaIssues.length > 0) {
          console.log(`QA Issues: ${stepResult.qaIssues.join(' | ')}`);
        }
        if (!stepResult.ok) {
          console.log(`Step Error: ${stepResult.error ?? 'Step validation failed.'}`);
        }
      }

      if (!stepResult.ok && !args.continueOnError) {
        break;
      }
    } catch (error) {
      const rawError = error instanceof Error ? error.message : String(error);
      const stepResult: PromptStepResult = {
        index: index + 1,
        prompt,
        ok: false,
        error: normalizeTransportError(rawError),
        toolCalls: [],
      };
      results.push(stepResult);

      if (args.verbose) {
        console.log(`\n[Step ${stepResult.index}] ${prompt}`);
        console.log(`Error: ${stepResult.error}`);
      }

      if (!args.continueOnError) {
        break;
      }
    }
  }

  let transcriptPath: string | undefined;
  if (args.outFile) {
    transcriptPath = await writeTranscript(args.outFile, args, messages);
  }

  const ok = results.every((result) => result.ok);
  const summary = {
    ok,
    api,
    threadId: args.threadId,
    stepCount: results.length,
    transcriptPath: transcriptPath ?? null,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
