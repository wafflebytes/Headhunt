import fs from 'node:fs/promises';
import path from 'node:path';

const CHAT_LOG_JSON_MARKER = 'HHLOG_JSON';

type AnyRecord = Record<string, unknown>;

type CliArgs = {
  filePath?: string;
  requireScheduling: boolean;
  verbose: boolean;
};

function printUsage() {
  console.log(`Usage:
  npm run smoke:chat-log -- --file <path-to-log.txt> [--require-scheduling] [--verbose]
  pbpaste | npm run smoke:chat-log -- [--require-scheduling] [--verbose]

Accepted input:
- Raw JSON payload exported by Copy Logs
- Text that starts with the HHLOG_JSON marker followed by JSON`);
}

function parseArgs(argv: string[]): CliArgs {
  let filePath: string | undefined;
  let requireScheduling = false;
  let verbose = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--require-scheduling') {
      requireScheduling = true;
      continue;
    }

    if (arg === '--verbose') {
      verbose = true;
      continue;
    }

    if (arg === '--file') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --file.');
      }

      filePath = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { filePath, requireScheduling, verbose };
}

async function readFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function readInput(filePath?: string): Promise<{ raw: string; source: string }> {
  if (filePath) {
    const absolutePath = path.resolve(filePath);
    const raw = await fs.readFile(absolutePath, 'utf8');
    return { raw, source: absolutePath };
  }

  const raw = await readFromStdin();
  if (!raw.trim()) {
    throw new Error('No input provided. Use --file <path> or pipe HHLOG_JSON content via stdin.');
  }

  return { raw, source: 'stdin' };
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  const firstNewline = trimmed.indexOf('\n');
  const lastFence = trimmed.lastIndexOf('```');

  if (firstNewline === -1 || lastFence <= firstNewline) {
    return trimmed;
  }

  return trimmed.slice(firstNewline + 1, lastFence).trim();
}

function normalizePayloadInput(raw: string): string {
  const markerIndex = raw.indexOf(CHAT_LOG_JSON_MARKER);
  const withoutMarker = markerIndex >= 0 ? raw.slice(markerIndex + CHAT_LOG_JSON_MARKER.length) : raw;
  return stripCodeFence(withoutMarker).trim();
}

function asRecord(value: unknown): AnyRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as AnyRecord;
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

function getMessageText(message: AnyRecord): string {
  return asString(message.text) ?? '';
}

function extractToolParts(message: AnyRecord): AnyRecord[] {
  const directToolParts = message.toolParts;
  if (Array.isArray(directToolParts)) {
    return directToolParts.map((part) => asRecord(part)).filter((part): part is AnyRecord => Boolean(part));
  }

  const raw = asRecord(message.raw);
  const parts = raw?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .map((part) => asRecord(part))
    .filter((part): part is AnyRecord => Boolean(part))
    .filter((part) => {
      const type = asString(part.type) ?? '';
      return (
        type.includes('tool') ||
        typeof part.toolCallId === 'string' ||
        typeof part.toolName === 'string' ||
        'input' in part ||
        'output' in part ||
        'state' in part
      );
    });
}

function isScheduleToolPart(part: AnyRecord): boolean {
  const type = asString(part.type) ?? '';
  const toolName = asString(part.toolName) ?? '';

  return toolName === 'schedule_interview_slots' || type.includes('schedule_interview_slots');
}

function getScheduleOutput(part: AnyRecord): AnyRecord | null {
  const output = asRecord(part.output);
  if (!output) {
    return null;
  }

  if (asString(output.check) !== 'schedule_interview_slots') {
    return null;
  }

  return output;
}

function containsRawToolMarkers(value: string): boolean {
  return (
    /functions\.[a-zA-Z0-9_]+:\d+\{\}/.test(value) ||
    /<\|[^|>]+\|>/.test(value) ||
    /\[\s*\{[\s\S]*?['"]type['"]\s*:\s*['"]text['"][\s\S]*?\}\s*\]/.test(value)
  );
}

function isLikelyAssistantStub(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/g, '');

  if (!normalized) {
    return false;
  }

  if (normalized === "i'll" || normalized === 'i will' || normalized === 'let me') {
    return true;
  }

  return /^(i'll|i will|let me)\s+[a-z]+$/.test(normalized);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { raw, source } = await readInput(args.filePath);
  const normalized = normalizePayloadInput(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new Error(
      `Failed to parse chat log JSON from ${source}: ${error instanceof Error ? error.message : 'Unknown parse error'}`,
    );
  }

  const payload = asRecord(parsed);
  if (!payload) {
    throw new Error('Parsed payload is not an object.');
  }

  const messagesRaw = payload.messages;
  if (!Array.isArray(messagesRaw)) {
    throw new Error('Parsed payload does not include a messages array.');
  }

  const messages = messagesRaw.map((message) => asRecord(message)).filter((message): message is AnyRecord => Boolean(message));

  const failures: string[] = [];
  const warnings: string[] = [];
  let scheduleOutputCount = 0;
  let scheduleErrorCount = 0;
  let scheduleProposeCount = 0;
  let scheduleScheduledCount = 0;

  messages.forEach((message, messageIndex) => {
    const role = asString(message.role) ?? 'unknown';
    const text = getMessageText(message);

    if (role === 'assistant' && text) {
      if (containsRawToolMarkers(text)) {
        failures.push(`assistant message #${messageIndex + 1}: leaked raw tool markers in text.`);
      }

      if (isLikelyAssistantStub(text)) {
        failures.push(`assistant message #${messageIndex + 1}: short stub text detected (e.g. "I'll"/"Let me").`);
      }
    }

    const toolParts = extractToolParts(message);
    toolParts
      .filter((part) => isScheduleToolPart(part))
      .forEach((part, toolPartIndex) => {
        const output = getScheduleOutput(part);
        if (!output) {
          return;
        }

        scheduleOutputCount += 1;

        const status = asString(output.status) ?? 'unknown';
        const mode = asString(output.mode);
        const errorMessage = asString(output.message) ?? '';
        const recovery = asRecord(output.recovery);
        const recoveryReason = asString(recovery?.reason);

        if (status === 'error') {
          scheduleErrorCount += 1;
        }

        if (mode === 'propose') {
          scheduleProposeCount += 1;
        }

        if (mode === 'schedule') {
          scheduleScheduledCount += 1;
        }

        if (status === 'error' && /stale|unavailable|conflict/i.test(errorMessage)) {
          failures.push(
            `message #${messageIndex + 1}, tool part #${toolPartIndex + 1}: schedule_interview_slots returned stale/conflict error instead of refreshed proposals.`,
          );
        }

        if (recoveryReason === 'stale_selected_start_iso' && !(status === 'success' && mode === 'propose')) {
          failures.push(
            `message #${messageIndex + 1}, tool part #${toolPartIndex + 1}: stale recovery reason must be returned with status=success and mode=propose.`,
          );
        }

        if (mode === 'propose') {
          const slots = Array.isArray(output.slots) ? output.slots : [];
          if (slots.length === 0) {
            warnings.push(
              `message #${messageIndex + 1}, tool part #${toolPartIndex + 1}: propose mode returned no slots. Consider expanding windowStartISO/windowEndISO.`,
            );
          }

          slots.forEach((slot, slotIndex) => {
            const slotRecord = asRecord(slot);
            const startISO = asString(slotRecord?.startISO);
            const endISO = asString(slotRecord?.endISO);
            const displayLabel = asString(slotRecord?.displayLabel);

            if (!slotRecord || !startISO || !endISO || !displayLabel) {
              failures.push(
                `message #${messageIndex + 1}, tool part #${toolPartIndex + 1}: slot #${slotIndex + 1} is missing startISO/endISO/displayLabel.`,
              );
            }
          });
        }
      });
  });

  if (args.requireScheduling && scheduleOutputCount === 0) {
    failures.push('No schedule_interview_slots outputs found, but --require-scheduling was requested.');
  }

  const summary = {
    ok: failures.length === 0,
    source,
    threadId: asString(payload.threadId),
    mode: asString(payload.mode),
    messageCount: messages.length,
    scheduling: {
      outputCount: scheduleOutputCount,
      proposeCount: scheduleProposeCount,
      scheduledCount: scheduleScheduledCount,
      errorCount: scheduleErrorCount,
    },
    failures,
    warnings,
  };

  if (args.verbose || failures.length > 0 || warnings.length > 0) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          ok: summary.ok,
          source: summary.source,
          messageCount: summary.messageCount,
          scheduling: summary.scheduling,
        },
        null,
        2,
      ),
    );
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
