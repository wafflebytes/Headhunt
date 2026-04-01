import { type UIMessage } from 'ai';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

import { MemoizedMarkdown } from './memoized-markdown';
import { cn } from '@/utils/cn';

type ToolCallStatus = 'pending' | 'complete' | 'error';

type ToolCallView = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: ToolCallStatus;
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
  return trimmed ? trimmed : null;
}

function decodeEscapedText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractSerializedTextPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const textParts = parsed
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const maybeText = (item as { text?: unknown }).text;
          return typeof maybeText === 'string' ? maybeText : '';
        })
        .filter(Boolean);

      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
  } catch {
    // Fall back to regex extraction for Python-like single-quoted payloads.
  }

  const textMatches = Array.from(trimmed.matchAll(/['"]text['"]\s*:\s*(['"])([\s\S]*?)\1/g));
  if (textMatches.length === 0) {
    return null;
  }

  const values = textMatches
    .map((match) => decodeEscapedText(match[2] ?? ''))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values.join('\n') : '';
}

function sanitizeAssistantText(raw: string): string {
  if (!raw) {
    return '';
  }

  let text = raw
    // Strip SDK/debug marker fragments that may leak as plain text.
    .replace(/functions\.[a-zA-Z0-9_]+:\d+\{\}(?:<\|[^|>]+\|>)*/g, '')
    .replace(/<\|[^|>]+\|>/g, '')
    .replace(/^functions\.[a-zA-Z0-9_]+:\d+\{\}\s*$/gm, '')
    .trim();

  // Replace embedded serialized text payload fragments with decoded text.
  text = text.replace(/\[\s*\{[\s\S]*?['"]type['"]\s*:\s*['"]text['"][\s\S]*?\}\s*\]/g, (match) => {
    const extracted = extractSerializedTextPayload(match);
    return extracted ?? '';
  });

  const extracted = extractSerializedTextPayload(text);
  if (extracted !== null) {
    text = extracted.trim();
  }

  // Ignore noise payloads containing only separators/whitespace.
  if (/^[|\s]*$/.test(text)) {
    return '';
  }

  return text;
}

function uiMessageToText(message: UIMessage): string {
  if (Array.isArray((message as any).parts)) {
    return (message as any).parts
      .map((p: any) => {
        if (typeof p === 'string') return p;
        if (p?.type === 'text' && typeof p.text === 'string') return p.text;
        if (!p?.type && typeof p?.text === 'string') return p.text;
        return '';
      })
      .join('');
  }

  return (message as any).content ?? '';
}

function parseToolPart(part: any): { toolCallId: string; toolName: string } | null {
  const partRecord = asRecord(part);
  if (!partRecord) {
    return null;
  }

  const toolInvocation = asRecord(partRecord.toolInvocation);
  const partType = asNonEmptyString(partRecord.type) ?? '';

  const toolCallId =
    asNonEmptyString(partRecord.toolCallId) ??
    asNonEmptyString(partRecord.id) ??
    asNonEmptyString(toolInvocation?.toolCallId) ??
    null;

  let toolName: string | null =
    asNonEmptyString(partRecord.toolName) ??
    asNonEmptyString(partRecord.name) ??
    asNonEmptyString(toolInvocation?.toolName) ??
    null;

  if (
    !toolName &&
    partType.startsWith('tool-') &&
    partType !== 'tool-call' &&
    partType !== 'tool-result' &&
    partType !== 'tool-error' &&
    partType !== 'tool-output-denied'
  ) {
    toolName = partType.replace(/^tool-/, '').trim();
  }

  if (!toolCallId || !toolName) {
    return null;
  }

  return { toolCallId, toolName };
}

function getToolCallsFromMessage(message: UIMessage): ToolCallView[] {
  const parts = (message as any).parts;
  if (!Array.isArray(parts)) return [];

  const byId = new Map<string, ToolCallView>();

  for (const part of parts) {
    const partRecord = asRecord(part);
    const parsed = parseToolPart(partRecord);
    if (!parsed) {
      continue;
    }

    const toolInvocation = asRecord(partRecord?.toolInvocation);

    const existing = byId.get(parsed.toolCallId) ?? {
      toolCallId: parsed.toolCallId,
      toolName: parsed.toolName,
      args: {},
      status: 'pending' as ToolCallStatus,
    };

    existing.toolName = parsed.toolName || existing.toolName;

    const args =
      partRecord?.input ??
      partRecord?.args ??
      partRecord?.parameters ??
      toolInvocation?.input ??
      toolInvocation?.args;

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      existing.args = args as Record<string, unknown>;
    }

    const result = partRecord?.output ?? partRecord?.result ?? toolInvocation?.output ?? toolInvocation?.result;
    if (result !== undefined) {
      existing.result = result;
      existing.status = 'complete';
    }

    const partType = asNonEmptyString(partRecord?.type) ?? '';
    const partState = asNonEmptyString(partRecord?.state) ?? '';

    if (partState === 'output-available' || partType === 'tool-output-available') {
      existing.status = 'complete';
    }

    if (
      partState === 'output-error' ||
      partState === 'output-denied' ||
      partState === 'error' ||
      partType === 'tool-error' ||
      partType === 'tool-output-denied' ||
      partRecord?.isError === true
    ) {
      existing.status = 'error';
    }

    if (partType === 'tool-result') {
      existing.status = 'complete';
      if (partRecord?.output !== undefined) {
        existing.result = partRecord.output;
      }
    }

    byId.set(parsed.toolCallId, existing);
  }

  return Array.from(byId.values());
}

function summarizeToolResult(result: unknown): string | null {
  if (typeof result === 'string' && result.trim()) {
    return result.trim();
  }

  if (!result || typeof result !== 'object') {
    return null;
  }

  const maybeMessage = (result as { message?: unknown }).message;
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
    return maybeMessage.trim();
  }

  const continueInterruption = (result as { continueInterruption?: unknown }).continueInterruption;
  if (continueInterruption === true) {
    return 'Authorization is required to continue. Click Authorize in the popup.';
  }

  const check = (result as { check?: unknown }).check;
  const status = (result as { status?: unknown }).status;
  if (typeof check === 'string' && typeof status === 'string') {
    const readableCheck = check.replace(/^verify_/, '').replace(/_/g, ' ').trim();
    const readableStatus = status === 'healthy' ? 'healthy' : 'needs attention';
    return `${readableCheck}: ${readableStatus}.`;
  }

  return null;
}

function getAssistantFallbackText(toolCalls: ToolCallView[]): string {
  if (toolCalls.length === 0) {
    return '';
  }

  if (toolCalls.some((toolCall) => toolCall.status === 'pending')) {
    return 'Working on your request...';
  }

  const summaries = toolCalls
    .filter((toolCall) => toolCall.status === 'complete')
    .map((toolCall) => summarizeToolResult(toolCall.result))
    .filter((value): value is string => Boolean(value));

  if (summaries.length > 0) {
    return summaries.join('\n');
  }

  if (toolCalls.some((toolCall) => toolCall.status === 'error')) {
    return 'The request ran into an error. Please try again.';
  }

  return 'Completed. See tool output above.';
}

function isLikelyAssistantStub(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '');

  if (!normalized) {
    return false;
  }

  if (normalized === "i'll" || normalized === 'i will' || normalized === 'let me') {
    return true;
  }

  const shortPreamble = /^(i'll|i will|let me)\s+[a-z]+$/;
  return shortPreamble.test(normalized);
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCallView }) {
  const { toolName, args, result, status } = toolCall;

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-600">
      <div className="flex items-center gap-2 mb-2">
        {status === 'pending' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
        {status === 'complete' && <CheckCircle className="w-4 h-4 text-green-500" />}
        {status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
          {status === 'pending' && `Calling ${toolName}...`}
          {status === 'complete' && `Called ${toolName}`}
          {status === 'error' && `Error calling ${toolName}`}
        </span>
      </div>

      {Object.keys(args).length > 0 && (
        <div className="mb-2">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 font-medium">Input:</div>
          <div className="bg-white dark:bg-gray-900 rounded px-3 py-2 text-xs font-mono border border-gray-200 dark:border-gray-700">
            {Object.entries(args).map(([key, value]) => (
              <div key={key} className="mb-1 last:mb-0">
                <span className="text-blue-600 dark:text-blue-400">{key}:</span>{' '}
                <span className="text-gray-800 dark:text-gray-200">
                  {typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result !== undefined && (
        <div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 font-medium">Output:</div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 text-xs border border-green-200 dark:border-green-800">
            <span className="text-green-800 dark:text-green-200">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatMessageBubble(props: { message: UIMessage; aiEmoji?: string }) {
  const { message, aiEmoji } = props;
  const toolCalls = getToolCallsFromMessage(message);
  const text = message.role === 'assistant' ? sanitizeAssistantText(uiMessageToText(message)) : uiMessageToText(message);
  const hideStubText = message.role === 'assistant' && isLikelyAssistantStub(text);
  const renderedText = hideStubText ? '' : text;
  const fallbackText = message.role === 'assistant' && !renderedText ? getAssistantFallbackText(toolCalls) : '';

  if (message.role === 'assistant' && !renderedText && !fallbackText && toolCalls.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-[24px] max-w-[80%] mb-8 flex',
        message.role === 'user' ? 'bg-secondary text-secondary-foreground px-4 py-2' : null,
        message.role === 'user' ? 'ml-auto' : 'mr-auto',
      )}
    >
      {message.role !== 'user' && (
        <div className="mr-4 -mt-2 mt-1 border bg-secondary rounded-full w-10 h-10 flex-shrink-0 flex items-center justify-center">
          {aiEmoji}
        </div>
      )}

      <div className="chat-message-bubble whitespace-pre-wrap flex flex-col prose dark:prose-invert max-w-none">
        {toolCalls.length > 0 && (
          <div className="mb-3">
            {toolCalls.map((toolCall) => (
              <ToolCallDisplay key={toolCall.toolCallId} toolCall={toolCall} />
            ))}
          </div>
        )}

        {(renderedText || fallbackText) && <MemoizedMarkdown content={renderedText || fallbackText} id={message.id as any} />}
      </div>
    </div>
  );
}
