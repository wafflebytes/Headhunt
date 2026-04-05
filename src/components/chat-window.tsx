'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { type UIMessage, DefaultChatTransport, generateId, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useChat } from '@ai-sdk/react';
import { toast } from 'sonner';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import {
  Activity01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  Key01Icon,
  Loading03Icon,
  RefreshIcon,
  SquareIcon,
} from '@hugeicons/core-free-icons';
import { useInterruptions } from '@auth0/ai-vercel/react';

import { TokenVaultInterruptHandler } from '@/components/TokenVaultInterruptHandler';
import { ChatMessageBubble, type ToolCallStatus, type ToolCallTimingInfo } from '@/components/chat-message-bubble';
import { FounderSlotSelectionPanel } from '@/components/founder-slot-selection-panel';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/cn';

const CHAT_STORAGE_KEY_PREFIX = 'headhunt:m1:chat:messages';
const CHAT_THREAD_ID_PREFIX = 'headhunt-m1-chat';
const CHAT_JOB_PICKER_STORAGE_KEY_PREFIX = 'headhunt:m1:chat:selected-job';
const CHAT_STORAGE_VERSION = 'v2';
const RUN_CONNECTION_DIAGNOSTICS_PROMPT =
  'run_connection_diagnostics: call run_connection_diagnostics and summarize each check, including missing connections/scopes and exact next authorization step.';
const AUTHORIZATION_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const AUTHORIZATION_STEP_POLL_MS = 400;
const CHAT_LOG_JSON_MARKER = 'HHLOG_JSON';
const TOKEN_VAULT_AUTHORIZATION_REQUIRED_PATTERN = /authorization required to access the token vault/i;
const TOKEN_VAULT_CONNECTION_PATTERN = /authorization required to access the token vault:\s*([a-z0-9._-]+)/i;

const TOKEN_VAULT_DEFAULT_SCOPES_BY_CONNECTION: Record<string, string[]> = {
  'google-oauth2': [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  'sign-in-with-slack': ['channels:read', 'channels:history', 'chat:write'],
  slack: ['channels:read', 'channels:history', 'chat:write'],
  'slack-oauth2': ['channels:read', 'channels:history', 'chat:write'],
  'cal-connection': [
    'PROFILE_READ',
    'SCHEDULE_READ',
    'SCHEDULE_WRITE',
    'BOOKING_READ',
    'BOOKING_WRITE',
    'EVENT_TYPE_READ',
    'EVENT_TYPE_WRITE',
  ],
};

const TOKEN_VAULT_DEFAULT_AUTHORIZATION_PARAMS_BY_CONNECTION: Record<string, Record<string, string>> = {
  'sign-in-with-slack': { prompt: 'consent' },
  slack: { prompt: 'consent' },
  'slack-oauth2': { prompt: 'consent' },
  'cal-connection': { prompt: 'consent' },
};

const OPERATOR_COMMAND_TEMPLATES: Array<{ label: string; value: string }> = [
  {
    label: '/run intake',
    value: '/run intake job <job_id> organization <org_id>',
  },
  {
    label: '/score candidate',
    value: '/score candidate <candidate_id> job <job_id> emailText "<email text snippet>"',
  },
  {
    label: '/analyze-consensus',
    value:
      '/analyze-consensus candidate <candidate_id> job <job_id> turns 3 requirements "TypeScript,Next.js,System design" externalContext "GitHub profile + portfolio notes"',
  },
  {
    label: '/schedule candidate',
    value:
      '/schedule candidate <candidate_id> job <job_id> eventTypeSlug 30min username <cal_username> action auto sendMode send days sat,sun timezone America/Los_Angeles',
  },
  {
    label: '/schedule-cal candidate',
    value:
      '/schedule-cal candidate <candidate_id> job <job_id> eventTypeId <event_type_id> timezone America/Los_Angeles',
  },
  {
    label: '/propose candidate',
    value:
      '/propose candidate <candidate_id> job <job_id> sendMode send timezone America/Los_Angeles calendar true',
  },
  {
    label: '/analyze-reply candidate',
    value: '/analyze-reply candidate <candidate_id> job <job_id> timezone America/Los_Angeles',
  },
  {
    label: 'confirm slot',
    value:
      'schedule_interview_slots with candidateId <candidate_id> jobId <job_id> selectedStartISO "<selected_start_iso>" timezone America/Los_Angeles',
  },
  {
    label: 'parse availability (fallback)',
    value:
      'parse_candidate_availability with candidateId <candidate_id> availabilityText "Tuesday 2-5 PM PT" timezone America/Los_Angeles',
  },
  {
    label: 'send confirmation',
    value: 'send_interview_confirmation with candidateId <candidate_id> jobId <job_id> sendMode send',
  },
  {
    label: '/draft-offer candidate',
    value:
      '/draft-offer candidate <candidate_id> job <job_id> salary 185000 currency USD start 2026-05-01',
  },
  {
    label: 'submit clearance',
    value: 'submit_offer_for_clearance with offerId <offer_id>',
  },
  {
    label: 'poll clearance',
    value: 'poll_offer_clearance with offerId <offer_id> authReqId <auth_req_id>',
  },
];

type ChatLogMode = 'latest_exchange' | 'full_session';

type ToolTimingByKey = Record<string, ToolCallTimingInfo>;

const AUTHORIZATION_STEPS = [
  {
    label: 'Google',
    prompt:
      'authorize_connections_step:google. Call only verify_google_connection. If authorization is needed, prompt to authorize and stop.',
  },
  {
    label: 'Cal',
    prompt:
      'authorize_connections_step:cal. Call only verify_cal_connection. If authorization is needed, prompt to authorize and stop.',
  },
  {
    label: 'Slack',
    prompt:
      'authorize_connections_step:slack. Call only verify_slack_connection. If authorization is needed, prompt to authorize and stop.',
  },
];

export type ChatJobPickerOption = {
  id: string;
  title: string;
  organizationId?: string | null;
  isActive: boolean;
};

type WorkflowIdKey =
  | 'jobId'
  | 'organizationId'
  | 'candidateId'
  | 'interviewId'
  | 'offerId'
  | 'authReqId'
  | 'selectedStartISO'
  | 'eventId';

type WorkflowIdEntry = {
  key: WorkflowIdKey;
  value: string;
};

type WorkflowIdCatalog = {
  entries: WorkflowIdEntry[];
  latest: Partial<Record<WorkflowIdKey, string>>;
};

type TokenVaultFallbackInterrupt = {
  fallbackKey: string;
  connection: string;
  requiredScopes: string[];
  authorizationParams?: Record<string, string>;
  message: string;
};

function normalizeIdString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatWorkflowIdLabel(key: WorkflowIdKey): string {
  switch (key) {
    case 'jobId':
      return 'Job ID';
    case 'organizationId':
      return 'Organization ID';
    case 'candidateId':
      return 'Candidate ID';
    case 'interviewId':
      return 'Interview ID';
    case 'offerId':
      return 'Offer ID';
    case 'authReqId':
      return 'Approval Request ID';
    case 'selectedStartISO':
      return 'Selected Start ISO';
    case 'eventId':
      return 'Calendar Event ID';
    default:
      return key;
  }
}

function formatWorkflowIdShortcut(value: string): string {
  if (value.length <= 28) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function buildWorkflowIdCatalog(params: {
  messages: UIMessage[];
  selectedJob: ChatJobPickerOption | null;
}): WorkflowIdCatalog {
  const entries: WorkflowIdEntry[] = [];
  const latest: Partial<Record<WorkflowIdKey, string>> = {};
  const seen = new Set<string>();

  const addId = (key: WorkflowIdKey, rawValue: unknown) => {
    const value = normalizeIdString(rawValue);
    if (!value) {
      return;
    }

    if (!latest[key]) {
      latest[key] = value;
    }

    const signature = `${key}:${value}`;
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    entries.push({ key, value });
  };

  if (params.selectedJob?.id) {
    addId('jobId', params.selectedJob.id);
  }

  if (params.selectedJob?.organizationId) {
    addId('organizationId', params.selectedJob.organizationId);
  }

  const scanUnknown = (value: unknown, parentKey?: string) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        scanUnknown(item, parentKey);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'candidateId') addId('candidateId', childValue);
      if (key === 'jobId') addId('jobId', childValue);
      if (key === 'organizationId') addId('organizationId', childValue);
      if (key === 'interviewId') addId('interviewId', childValue);
      if (key === 'offerId') addId('offerId', childValue);
      if (key === 'authReqId' || key === 'cibaAuthReqId') addId('authReqId', childValue);
      if (key === 'selectedStartISO') addId('selectedStartISO', childValue);
      if (key === 'id' && parentKey === 'event') addId('eventId', childValue);
      if (key === 'startISO' && parentKey === 'slots') addId('selectedStartISO', childValue);

      scanUnknown(childValue, key);
    }
  };

  for (let messageIndex = params.messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = params.messages[messageIndex];
    const toolParts = extractToolParts(message);

    for (let partIndex = toolParts.length - 1; partIndex >= 0; partIndex--) {
      const part = toolParts[partIndex];
      scanUnknown(part.input);
      scanUnknown(part.output);
    }
  }

  return {
    entries,
    latest,
  };
}

function uiMessageToText(message: UIMessage): string {
  const parts = (message as { parts?: unknown }).parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const maybeText = (part as { text?: unknown }).text;
          if (typeof maybeText === 'string') return maybeText;
        }

        return '';
      })
      .join('');
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function decodeEscapedLogText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function sanitizeAssistantLogText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  const textMatches = Array.from(trimmed.matchAll(/['"]text['"]\s*:\s*(['"])([\s\S]*?)\1/g));
  if (textMatches.length === 0) {
    return raw;
  }

  const values = textMatches
    .map((match) => decodeEscapedLogText(match[2] ?? '').trim())
    .filter(Boolean);

  if (values.length === 0) {
    return '';
  }

  return values.join('\n');
}

function shouldAutoSubmitAfterToolCalls(messages: UIMessage[]): boolean {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const lastUserText = lastUserMessage ? uiMessageToText(lastUserMessage) : '';
  const trimmedUserText = lastUserText.trim();

  // Slash commands in this console are expected to be one-shot execution requests.
  // Auto-submitting a follow-up turn can trigger unintended extra tool calls.
  if (/^\/[a-z0-9_-]+\b/i.test(trimmedUserText)) {
    return false;
  }

  const isControlFlowPrompt =
    /\bauthorize_connections_step:[a-z_]+\b/i.test(lastUserText) ||
    /\brun_connection_diagnostics\b/i.test(lastUserText) ||
    /\brun\s+connection\s+diagnostics\b/i.test(lastUserText);

  if (isControlFlowPrompt) {
    return false;
  }

  return lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

function runtimeBadgeClass(status: string): string {
  if (status === 'streaming') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }

  if (status === 'submitted') {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
  }

  return 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200';
}

function normalizeIdentity(rawIdentity: string | null | undefined) {
  if (!rawIdentity) {
    return 'anonymous';
  }

  return encodeURIComponent(rawIdentity.trim());
}

function pickDefaultJobId(
  options: ChatJobPickerOption[],
  explicitDefaultJobId?: string,
): string | null {
  if (explicitDefaultJobId) {
    const explicit = options.find((option) => option.id === explicitDefaultJobId && option.isActive);
    if (explicit) {
      return explicit.id;
    }
  }

  const foundingEngineer = options.find(
    (option) => option.isActive && /founding\s+engineer/i.test(option.title),
  );
  if (foundingEngineer) {
    return foundingEngineer.id;
  }

  const firstActive = options.find((option) => option.isActive);
  return firstActive?.id ?? null;
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, item) => {
      if (item instanceof Date) {
        return item.toISOString();
      }

      if (typeof item === 'bigint') {
        return item.toString();
      }

      if (typeof item === 'function') {
        return '[function]';
      }

      if (typeof item === 'symbol') {
        return item.toString();
      }

      if (item && typeof item === 'object') {
        if (seen.has(item as object)) {
          return '[circular]';
        }
        seen.add(item as object);
      }

      return item;
    },
    2,
  );
}

async function writeClipboardText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error('Clipboard write is not available in this browser context.');
  }
}

function extractToolParts(message: UIMessage) {
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return null;
      }

      const value = part as Record<string, unknown>;
      const partType = typeof value.type === 'string' ? value.type : null;
      const looksLikeToolPart =
        (partType && partType.includes('tool')) ||
        'toolCallId' in value ||
        'toolName' in value ||
        'input' in value ||
        'output' in value ||
        'state' in value;

      if (!looksLikeToolPart) {
        return null;
      }

      return {
        type: partType,
        toolName: typeof value.toolName === 'string' ? value.toolName : null,
        toolCallId: typeof value.toolCallId === 'string' ? value.toolCallId : null,
        state: typeof value.state === 'string' ? value.state : null,
        input: value.input ?? null,
        output: value.output ?? null,
        error: value.error ?? value.errorText ?? null,
      };
    })
    .filter((part): part is NonNullable<typeof part> => Boolean(part));
}

function parseScopeList(raw: string): string[] {
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function extractRequiredScopesFromTokenVaultMessage(message: string): string[] {
  const missingScopesMatch = message.match(/missing scopes:\s*([^\n]+)/i);
  if (missingScopesMatch?.[1]) {
    return parseScopeList(missingScopesMatch[1]);
  }

  const requiredScopesMatch = message.match(/required scopes:\s*([^\n]+)/i);
  if (requiredScopesMatch?.[1]) {
    return parseScopeList(requiredScopesMatch[1]);
  }

  return [];
}

function inferConnectionFromToolName(toolName: string | null): string | null {
  if (!toolName) {
    return null;
  }

  const normalized = toolName.toLowerCase();
  if (normalized.includes('slack')) {
    return 'sign-in-with-slack';
  }

  if (normalized.includes('gmail') || normalized.includes('google') || normalized.includes('calendar')) {
    return 'google-oauth2';
  }

  if (normalized.includes('verify_cal_connection') || normalized.includes('schedule_with_cal')) {
    return 'cal-connection';
  }

  return null;
}

function getDefaultScopesForConnection(connection: string): string[] {
  return TOKEN_VAULT_DEFAULT_SCOPES_BY_CONNECTION[connection.toLowerCase()] ?? [];
}

function getDefaultAuthorizationParamsForConnection(connection: string): Record<string, string> | undefined {
  const params = TOKEN_VAULT_DEFAULT_AUTHORIZATION_PARAMS_BY_CONNECTION[connection.toLowerCase()];
  return params ? { ...params } : undefined;
}

function deriveTokenVaultFallbackInterrupt(messages: UIMessage[]): TokenVaultFallbackInterrupt | null {
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!latestAssistantMessage) {
    return null;
  }

  const toolParts = extractToolParts(latestAssistantMessage);
  for (let index = toolParts.length - 1; index >= 0; index -= 1) {
    const part = toolParts[index];
    if (typeof part.error !== 'string') {
      continue;
    }

    const errorMessage = part.error.trim();
    if (!TOKEN_VAULT_AUTHORIZATION_REQUIRED_PATTERN.test(errorMessage)) {
      continue;
    }

    const connectionFromMessage = errorMessage.match(TOKEN_VAULT_CONNECTION_PATTERN)?.[1]?.trim() ?? null;
    const connection = connectionFromMessage ?? inferConnectionFromToolName(part.toolName);
    if (!connection) {
      continue;
    }

    const requiredScopes = (() => {
      const fromMessage = extractRequiredScopesFromTokenVaultMessage(errorMessage);
      if (fromMessage.length > 0) {
        return fromMessage;
      }

      return getDefaultScopesForConnection(connection);
    })();

    const authorizationParams = getDefaultAuthorizationParamsForConnection(connection);

    return {
      fallbackKey: `${latestAssistantMessage.id}:${part.toolCallId ?? String(index)}:${connection}`,
      connection,
      requiredScopes,
      ...(authorizationParams ? { authorizationParams } : {}),
      message: errorMessage,
    };
  }

  return null;
}

function getMessageCreatedAtMs(message: UIMessage): number | undefined {
  const value = (message as { createdAt?: unknown }).createdAt;
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function deriveToolPartRuntimeStatus(
  part: ReturnType<typeof extractToolParts>[number],
): ToolCallStatus {
  const state = (part.state ?? '').toLowerCase();

  if (state === 'output-error' || state === 'output-denied' || state === 'error' || part.error) {
    return 'error';
  }

  if (state === 'output-available' || (part.output !== null && part.output !== undefined)) {
    return 'complete';
  }

  return 'pending';
}

function extractScheduleLogText(toolParts: ReturnType<typeof extractToolParts>): string | null {
  const schedulePart = [...toolParts].reverse().find((part) => {
    const partType = typeof part.type === 'string' ? part.type : '';
    return part.toolName === 'schedule_interview_slots' || partType.includes('schedule_interview_slots');
  });

  if (!schedulePart || !schedulePart.output || typeof schedulePart.output !== 'object') {
    return null;
  }

  const output = schedulePart.output as Record<string, unknown>;
  const check = typeof output.check === 'string' ? output.check : null;
  const status = typeof output.status === 'string' ? output.status : null;
  const mode = typeof output.mode === 'string' ? output.mode : null;

  if (check !== 'schedule_interview_slots') {
    return null;
  }

  if (status === 'error') {
    const message = typeof output.message === 'string' ? output.message : 'Unknown scheduling error.';
    return `Scheduling failed: ${message}`;
  }

  if (status !== 'success') {
    return null;
  }

  if (mode === 'propose') {
    const recovery = output.recovery && typeof output.recovery === 'object' ? (output.recovery as Record<string, unknown>) : null;
    const recoveryMessage = recovery && typeof recovery.message === 'string' ? recovery.message : null;
    const recoveryReason = recovery && typeof recovery.reason === 'string' ? recovery.reason : null;

    const slots = Array.isArray(output.slots) ? output.slots : [];
    const recommendedIndex =
      typeof output.recommendedSlotIndex === 'number' && Number.isInteger(output.recommendedSlotIndex)
        ? output.recommendedSlotIndex
        : -1;

    const lines = slots
      .map((slot, index) => {
        if (!slot || typeof slot !== 'object') {
          return null;
        }

        const slotRecord = slot as Record<string, unknown>;
        const displayLabel = typeof slotRecord.displayLabel === 'string' ? slotRecord.displayLabel : null;
        const startISO = typeof slotRecord.startISO === 'string' ? slotRecord.startISO : null;
        if (!displayLabel || !startISO) {
          return null;
        }

        const suffix = index === recommendedIndex ? ' (recommended)' : '';
        return `${index + 1}. ${displayLabel}${suffix} | selectedStartISO: \"${startISO}\"`;
      })
      .filter((line): line is string => Boolean(line));

    const intro =
      recoveryMessage ??
      (recoveryReason === 'stale_selected_start_iso'
        ? 'Selected slot was stale. Returning refreshed interview slots.'
        : 'Interview slots proposed (not scheduled yet).');

    if (lines.length === 0) {
      return `${intro}`;
    }

    const recommendedSlot =
      recommendedIndex >= 0 && recommendedIndex < slots.length && slots[recommendedIndex] && typeof slots[recommendedIndex] === 'object'
        ? (slots[recommendedIndex] as Record<string, unknown>)
        : null;
    const recommendedStartISO =
      recommendedSlot && typeof recommendedSlot.startISO === 'string' ? recommendedSlot.startISO : null;
    const confirmHint = recommendedStartISO
      ? `Reply with selectedStartISO "${recommendedStartISO}" to confirm scheduling.`
      : 'Reply with a selectedStartISO from the list to confirm scheduling.';

    return `${intro}\n${lines.join('\n')}\n${confirmHint}`;
  }

  if (mode === 'schedule') {
    const event = output.event && typeof output.event === 'object' ? (output.event as Record<string, unknown>) : null;
    const displayLabel = event && typeof event.displayLabel === 'string' ? event.displayLabel : null;
    const htmlLink = event && typeof event.htmlLink === 'string' ? event.htmlLink : null;
    const meetLink = event && typeof event.meetLink === 'string' ? event.meetLink : null;

    const lines = ['Interview scheduled successfully.'];
    if (displayLabel) {
      lines.push(`Slot: ${displayLabel}`);
    }
    if (meetLink) {
      lines.push(`Meet link: ${meetLink}`);
    }
    if (htmlLink) {
      lines.push(`Calendar event: ${htmlLink}`);
    }

    return lines.join('\n');
  }

  return null;
}

function toLogEntry(message: UIMessage) {
  const maybeCreatedAt = (message as { createdAt?: unknown }).createdAt;
  const createdAt = maybeCreatedAt instanceof Date ? maybeCreatedAt.toISOString() : typeof maybeCreatedAt === 'string' ? maybeCreatedAt : null;
  const toolParts = extractToolParts(message);
  const rawText = uiMessageToText(message);
  const scheduleLogText = message.role === 'assistant' ? extractScheduleLogText(toolParts) : null;
  const text = scheduleLogText ?? (message.role === 'assistant' ? sanitizeAssistantLogText(rawText) : rawText);

  return {
    id: message.id,
    role: message.role,
    createdAt,
    text: text || null,
    toolParts,
    raw: message,
  };
}

function selectLatestExchange(messages: UIMessage[]): UIMessage[] {
  const lastUserIndex = [...messages].map((message) => message.role).lastIndexOf('user');

  if (lastUserIndex === -1) {
    return messages.slice(-2);
  }

  const assistantAfterUserIndex = messages.findIndex((message, index) => index > lastUserIndex && message.role === 'assistant');

  if (assistantAfterUserIndex !== -1) {
    let end = messages.length;
    for (let i = assistantAfterUserIndex + 1; i < messages.length; i++) {
      if (messages[i]?.role === 'user') {
        end = i;
        break;
      }
    }

    return messages.slice(lastUserIndex, end);
  }

  const previousAssistantIndex = [...messages]
    .map((message) => message.role)
    .lastIndexOf('assistant', lastUserIndex);

  if (previousAssistantIndex !== -1) {
    return messages.slice(previousAssistantIndex, lastUserIndex + 1);
  }

  return [messages[lastUserIndex]].filter(Boolean);
}

function ChatMessages(props: {
  messages: UIMessage[];
  emptyStateComponent: ReactNode;
  aiEmoji?: string;
  toolTimingByKey: ToolTimingByKey;
  toolTimingNowMs: number;
  className?: string;
}) {
  return (
    <div className="flex flex-col max-w-[768px] mx-auto pb-12 w-full">
      {props.messages.map((m) => {
        return (
          <ChatMessageBubble
            key={m.id}
            message={m}
            aiEmoji={props.aiEmoji}
            toolTimingByKey={props.toolTimingByKey}
            nowMs={props.toolTimingNowMs}
          />
        );
      })}
    </div>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button variant="outline" className={props.className} onClick={() => scrollToBottom()}>
      <HugeIcon icon={ArrowDown01Icon} size={16} strokeWidth={2.2} className="w-4 h-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

function ChatInput(props: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loading?: boolean;
  placeholder?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.stopPropagation();
        e.preventDefault();
        props.onSubmit(e);
      }}
      className={cn('flex w-full flex-col', props.className)}
    >
      <div className="border border-input bg-background rounded-lg flex flex-col gap-2 max-w-[768px] w-full mx-auto">
        <input
          value={props.value}
          placeholder={props.placeholder}
          onChange={props.onChange}
          className="border-none outline-none bg-transparent p-4"
        />

        <div className="flex justify-between ml-4 mr-2 mb-2">
          <div className="flex gap-3">{props.children}</div>

          <Button
            className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
            type="submit"
            disabled={props.loading}
          >
            {props.loading ? (
              <HugeIcon icon={Loading03Icon} size={14} strokeWidth={2.2} className="animate-spin" />
            ) : (
              <HugeIcon icon={ArrowUp01Icon} size={14} strokeWidth={2.2} />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();

  // scrollRef will also switch between overflow: unset to overflow: auto
  return (
    <div
      ref={context.scrollRef}
      style={{ width: '100%', height: '100%' }}
      className={cn('grid grid-rows-[1fr,auto]', props.className)}
    >
      <div ref={context.contentRef} className={props.contentClassName}>
        {props.content}
      </div>

      {props.footer}
    </div>
  );
}

export function ChatWindow(props: {
  endpoint: string;
  emptyStateComponent: ReactNode;
  placeholder?: string;
  emoji?: string;
  userId: string;
  jobOptions?: ChatJobPickerOption[];
  defaultJobId?: string;
  initialQuery?: { text: string; id: number } | null;
}) {
  const scopedUserId = normalizeIdentity(props.userId);
  const chatStorageKey = `${CHAT_STORAGE_KEY_PREFIX}:${CHAT_STORAGE_VERSION}:${scopedUserId}`;
  const chatThreadId = `${CHAT_THREAD_ID_PREFIX}:${CHAT_STORAGE_VERSION}:${scopedUserId}`;
  const jobPickerStorageKey = `${CHAT_JOB_PICKER_STORAGE_KEY_PREFIX}:${CHAT_STORAGE_VERSION}:${scopedUserId}`;
  const autoSubmitBlockedUntilMsRef = useRef(0);

  const jobOptions = useMemo(() => props.jobOptions ?? [], [props.jobOptions]);
  const defaultSelectableJobId = useMemo(
    () => pickDefaultJobId(jobOptions, props.defaultJobId),
    [jobOptions, props.defaultJobId],
  );

  const [selectedJobId, setSelectedJobId] = useState<string | null>(defaultSelectableJobId);
  const selectedJob = useMemo(
    () => jobOptions.find((option) => option.id === selectedJobId && option.isActive) ?? null,
    [jobOptions, selectedJobId],
  );

  const hasActiveJobOptions = jobOptions.some((option) => option.isActive);
  const hasLoadedPersistedJobSelection = useRef(false);
  const selectedJobContextRef = useRef<{
    selectedJobId?: string;
    selectedJobTitle?: string;
    selectedJobOrganizationId?: string;
    selectedJobStatus?: 'active';
  }>({});

  selectedJobContextRef.current = {
    ...(selectedJob?.id ? { selectedJobId: selectedJob.id } : {}),
    ...(selectedJob?.title ? { selectedJobTitle: selectedJob.title } : {}),
    ...(selectedJob?.organizationId ? { selectedJobOrganizationId: selectedJob.organizationId } : {}),
    ...(selectedJob?.isActive ? { selectedJobStatus: 'active' as const } : {}),
  };

  const { messages, sendMessage, status, toolInterrupt, stop, regenerate, setMessages } = useInterruptions((handler) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useChat({
      id: chatThreadId,
      transport: new DefaultChatTransport({
        api: props.endpoint,
        body: () => ({
          ...selectedJobContextRef.current,
        }),
      }),
      generateId,
      onError: handler((e: Error) => {
        console.error('Error: ', e);
        toast.error(`Error while processing your request`, { description: e.message });
      }),
      sendAutomaticallyWhen: ({ messages }) => {
        if (Date.now() < autoSubmitBlockedUntilMsRef.current) {
          return false;
        }

        return shouldAutoSubmitAfterToolCalls(messages as UIMessage[]);
      },
    }),
  );

  const workflowIdCatalog = useMemo(
    () => buildWorkflowIdCatalog({ messages, selectedJob }),
    [messages, selectedJob],
  );
  const hasWorkflowIds = workflowIdCatalog.entries.length > 0;

  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [isAuthorizationFlowRunning, setIsAuthorizationFlowRunning] = useState(false);
  const [activeAuthorizationStep, setActiveAuthorizationStep] = useState<string | null>(null);
  
  const lastProcessedQueryIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      props.initialQuery &&
      props.initialQuery.id !== lastProcessedQueryIdRef.current
    ) {
      lastProcessedQueryIdRef.current = props.initialQuery.id;
      const queryText = props.initialQuery.text;
      // Defer to let useChat fully hydrate before programmatic submit
      const timer = setTimeout(() => {
        sendMessage({ text: queryText });
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [props.initialQuery, sendMessage]);
  const [isCopyingLogs, setIsCopyingLogs] = useState(false);
  const [dismissedFallbackInterruptKey, setDismissedFallbackInterruptKey] = useState<string | null>(null);
  const [toolTimingByKey, setToolTimingByKey] = useState<ToolTimingByKey>({});
  const [toolTimingNowMs, setToolTimingNowMs] = useState(() => Date.now());
  const hasLoadedPersistedMessages = useRef(false);
  const statusRef = useRef(status);

  const fallbackTokenVaultInterrupt = useMemo(() => deriveTokenVaultFallbackInterrupt(messages), [messages]);
  const activeFallbackTokenVaultInterrupt = useMemo(() => {
    if (!fallbackTokenVaultInterrupt) {
      return null;
    }

    if (fallbackTokenVaultInterrupt.fallbackKey === dismissedFallbackInterruptKey) {
      return null;
    }

    return fallbackTokenVaultInterrupt;
  }, [dismissedFallbackInterruptKey, fallbackTokenVaultInterrupt]);

  const effectiveToolInterrupt = toolInterrupt ?? activeFallbackTokenVaultInterrupt;
  const interruptRef = useRef(effectiveToolInterrupt);

  const isChatBusy = status === 'submitted' || status === 'streaming';
  const hasAssistantMessages = messages.some((message) => message.role === 'assistant');
  const pendingToolCount = Object.values(toolTimingByKey).filter((timing) => timing.status === 'pending').length;
  const runtimeLabel =
    status === 'streaming' ? 'Streaming response' : status === 'submitted' ? 'Submitting request' : 'Ready';

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    interruptRef.current = effectiveToolInterrupt;
  }, [effectiveToolInterrupt]);

  useEffect(() => {
    if (!fallbackTokenVaultInterrupt && dismissedFallbackInterruptKey !== null) {
      setDismissedFallbackInterruptKey(null);
      return;
    }

    if (
      fallbackTokenVaultInterrupt &&
      dismissedFallbackInterruptKey &&
      fallbackTokenVaultInterrupt.fallbackKey !== dismissedFallbackInterruptKey
    ) {
      setDismissedFallbackInterruptKey(null);
    }
  }, [dismissedFallbackInterruptKey, fallbackTokenVaultInterrupt]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || hasLoadedPersistedJobSelection.current) {
      return;
    }

    const persistedJobId = window.localStorage.getItem(jobPickerStorageKey);
    if (
      persistedJobId &&
      jobOptions.some((option) => option.id === persistedJobId && option.isActive)
    ) {
      setSelectedJobId(persistedJobId);
    } else {
      setSelectedJobId(defaultSelectableJobId);
    }

    hasLoadedPersistedJobSelection.current = true;
  }, [defaultSelectableJobId, hydrated, jobOptions, jobPickerStorageKey]);

  useEffect(() => {
    if (!hydrated || !hasLoadedPersistedJobSelection.current) {
      return;
    }

    if (!selectedJob?.id) {
      window.localStorage.removeItem(jobPickerStorageKey);
      return;
    }

    window.localStorage.setItem(jobPickerStorageKey, selectedJob.id);
  }, [hydrated, jobPickerStorageKey, selectedJob]);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }

    const isStillActive = jobOptions.some(
      (option) => option.id === selectedJobId && option.isActive,
    );

    if (!isStillActive) {
      setSelectedJobId(defaultSelectableJobId);
    }
  }, [defaultSelectableJobId, jobOptions, selectedJobId]);

  useEffect(() => {
    if (!hydrated || hasLoadedPersistedMessages.current) {
      return;
    }

    const raw = window.localStorage.getItem(chatStorageKey);
    if (!raw) {
      hasLoadedPersistedMessages.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(raw) as UIMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
      }
    } catch (error) {
      console.warn('Failed to restore persisted chat messages.', error);
    } finally {
      hasLoadedPersistedMessages.current = true;
    }
  }, [chatStorageKey, hydrated, setMessages]);

  useEffect(() => {
    if (!hydrated || !hasLoadedPersistedMessages.current) {
      return;
    }

    window.localStorage.setItem(chatStorageKey, JSON.stringify(messages));
  }, [messages, hydrated, chatStorageKey]);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    setToolTimingByKey((current) => {
      const next = { ...current };
      let changed = false;
      const activeKeys = new Set<string>();

      for (const message of messages) {
        const messageCreatedAt = getMessageCreatedAtMs(message) ?? Date.now();
        const toolParts = extractToolParts(message);

        for (const part of toolParts) {
          if (!part.toolCallId) {
            continue;
          }

          const key = `${message.id}:${part.toolCallId}`;
          activeKeys.add(key);
          const runtimeStatus = deriveToolPartRuntimeStatus(part);
          const existing = next[key];

          if (!existing) {
            next[key] = {
              startedAt: messageCreatedAt,
              ...(runtimeStatus !== 'pending' ? { completedAt: messageCreatedAt } : {}),
              status: runtimeStatus,
            };
            changed = true;
            continue;
          }

          const updates: Partial<ToolCallTimingInfo> = {};
          if (existing.status !== runtimeStatus) {
            updates.status = runtimeStatus;
          }

          if ((runtimeStatus === 'complete' || runtimeStatus === 'error') && !existing.completedAt) {
            updates.completedAt = Date.now();
          }

          if (!existing.startedAt || existing.startedAt <= 0) {
            updates.startedAt = messageCreatedAt;
          }

          if (Object.keys(updates).length > 0) {
            next[key] = { ...existing, ...updates };
            changed = true;
          }
        }
      }

      for (const key of Object.keys(next)) {
        if (activeKeys.has(key)) {
          continue;
        }

        delete next[key];
        changed = true;
      }

      return changed ? next : current;
    });
  }, [messages]);

  useEffect(() => {
    const hasPendingTool = Object.values(toolTimingByKey).some((timing) => timing.status === 'pending');
    if (!hasPendingTool) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setToolTimingNowMs(Date.now());
    }, 200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [toolTimingByKey]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || isChatBusy) return;
    await sendMessage({ text: input });
    setInput('');
  }

  async function onRunConnectionDiagnostics() {
    if (isChatBusy || isAuthorizationFlowRunning) {
      return;
    }

    await sendMessage({ text: RUN_CONNECTION_DIAGNOSTICS_PROMPT });
  }

  function onStopGeneration() {
    autoSubmitBlockedUntilMsRef.current = Date.now() + 3000;
    stop();
  }

  function applyOperatorTemplateContext(template: string) {
    const replacements: Record<string, string | undefined> = {
      '<job_id>': selectedJob?.id ?? workflowIdCatalog.latest.jobId,
      '<org_id>': selectedJob?.organizationId ?? workflowIdCatalog.latest.organizationId,
      '<candidate_id>': workflowIdCatalog.latest.candidateId,
      '<interview_id>': workflowIdCatalog.latest.interviewId,
      '<offer_id>': workflowIdCatalog.latest.offerId,
      '<auth_req_id>': workflowIdCatalog.latest.authReqId,
      '<selected_start_iso>': workflowIdCatalog.latest.selectedStartISO,
    };

    let output = template;
    for (const [placeholder, value] of Object.entries(replacements)) {
      if (!value) {
        continue;
      }

      output = output.replace(new RegExp(placeholder, 'g'), value);
    }

    return output;
  }

  function onInsertOperatorCommand(template: string) {
    if (isChatBusy) {
      return;
    }

    setInput(applyOperatorTemplateContext(template));
  }

  function onSelectJob(jobId: string) {
    const option = jobOptions.find((item) => item.id === jobId);
    if (!option?.isActive) {
      toast.error('Selected job is not active.', {
        description: 'Pick an active job or run the demo seed command to create active options.',
      });
      return;
    }

    setSelectedJobId(option.id);
    toast.success('Target job updated.', {
      description: `${option.title} (${option.id})`,
    });
  }

  async function waitForStepCompletion() {
    const startedAt = Date.now();

    while (true) {
      const currentStatus = statusRef.current;
      const hasInterrupt = Boolean(interruptRef.current);
      const isBusy = currentStatus === 'submitted' || currentStatus === 'streaming';

      if (!isBusy && !hasInterrupt) {
        return;
      }

      if (Date.now() - startedAt > AUTHORIZATION_STEP_TIMEOUT_MS) {
        throw new Error('Authorization step timed out.');
      }

      await new Promise((resolve) => setTimeout(resolve, AUTHORIZATION_STEP_POLL_MS));
    }
  }

  async function onAuthorizeConnectionsOneByOne() {
    if (isAuthorizationFlowRunning || isChatBusy) {
      return;
    }

    setIsAuthorizationFlowRunning(true);

    try {
      for (const step of AUTHORIZATION_STEPS) {
        setActiveAuthorizationStep(step.label);
        await sendMessage({ text: step.prompt });
        await waitForStepCompletion();
      }

      toast.success('Authorization flow complete.', {
        description: 'Google and Slack authorization checks finished.',
      });
    } catch (error) {
      toast.error('Authorization flow stopped.', {
        description: error instanceof Error ? error.message : 'Unknown error while authorizing integrations.',
      });
    } finally {
      setIsAuthorizationFlowRunning(false);
      setActiveAuthorizationStep(null);
    }
  }

  function onTokenVaultInterruptFinish() {
    if (activeFallbackTokenVaultInterrupt) {
      setDismissedFallbackInterruptKey(activeFallbackTokenVaultInterrupt.fallbackKey);
    }
  }

  function onClearChat() {
    setMessages([]);
    setToolTimingByKey({});
    window.localStorage.removeItem(chatStorageKey);
  }

  async function onCopyWorkflowId(entry: WorkflowIdEntry) {
    try {
      await writeClipboardText(entry.value);
      toast.success(`${formatWorkflowIdLabel(entry.key)} copied.`, {
        description: entry.value,
      });
    } catch (error) {
      toast.error('Failed to copy ID.', {
        description: error instanceof Error ? error.message : 'Unknown clipboard error.',
      });
    }
  }

  async function onCopyAllWorkflowIds() {
    try {
      const payload = safeJsonStringify(workflowIdCatalog.latest);
      await writeClipboardText(payload);
      toast.success('Latest workflow IDs copied as JSON.');
    } catch (error) {
      toast.error('Failed to copy workflow IDs.', {
        description: error instanceof Error ? error.message : 'Unknown clipboard error.',
      });
    }
  }

  async function onCopyLogs(mode: ChatLogMode) {
    if (isCopyingLogs || messages.length === 0) {
      return;
    }

    setIsCopyingLogs(true);

    try {
      const selectedMessages = mode === 'latest_exchange' ? selectLatestExchange(messages) : messages;

      if (selectedMessages.length === 0) {
        toast.error('No chat logs available to copy.');
        return;
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        mode,
        threadId: chatThreadId,
        scopedUserId,
        messageCount: selectedMessages.length,
        messages: selectedMessages.map((message) => toLogEntry(message)),
      };

      const serializedPayload = safeJsonStringify(payload);
      const clipboardText = `${CHAT_LOG_JSON_MARKER}\n${serializedPayload}`;

      await writeClipboardText(clipboardText);

      toast.success('Chat logs copied.', {
        description:
          mode === 'latest_exchange'
            ? 'Copied latest user + assistant exchange with tool details.'
            : `Copied full session (${selectedMessages.length} messages) with tool details.`,
      });
    } catch (error) {
      toast.error('Failed to copy chat logs.', {
        description: error instanceof Error ? error.message : 'Unknown clipboard error.',
      });
    } finally {
      setIsCopyingLogs(false);
    }
  }

  return (
    <StickToBottom>
      <StickyToBottomContent
        className="absolute inset-0"
        contentClassName="py-8 px-2"
        content={
          messages.length === 0 ? (
            <div>{props.emptyStateComponent}</div>
          ) : (
            <>
              <ChatMessages
                aiEmoji={props.emoji}
                messages={messages}
                emptyStateComponent={props.emptyStateComponent}
                toolTimingByKey={toolTimingByKey}
                toolTimingNowMs={toolTimingNowMs}
              />
              <div className="flex flex-col max-w-[768px] mx-auto pb-12 w-full">
                <TokenVaultInterruptHandler interrupt={effectiveToolInterrupt} onFinish={onTokenVaultInterruptFinish} />
              </div>
            </>
          )
        }
        footer={
          <div className="sticky bottom-8 px-2">
            <ScrollToBottom className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4" />
            <details className="max-w-[768px] mx-auto mb-3 rounded-md border border-input bg-background/85 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium select-none">Founder Scheduling Panel (Cal link flow)</summary>
              <div className="pt-3">
                <FounderSlotSelectionPanel
                  defaultJobId={selectedJob?.id ?? null}
                  defaultOrganizationId={selectedJob?.organizationId ?? null}
                  disabled={isChatBusy}
                />
              </div>
            </details>
            <div className="max-w-[768px] mx-auto mb-3 flex justify-end gap-2">
              <span
                className={cn(
                  'mr-auto text-[11px] px-2 py-1 rounded-full font-medium uppercase tracking-wide self-center',
                  runtimeBadgeClass(status),
                )}
              >
                {runtimeLabel}
                {pendingToolCount > 0 ? ` · ${pendingToolCount} tool${pendingToolCount === 1 ? '' : 's'} running` : ''}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isChatBusy || !hasActiveJobOptions}>
                    Job: {selectedJob?.title ?? 'Select Active Job'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[340px]">
                  <DropdownMenuLabel>Target Job For Recruiting Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={selectedJob?.id ?? ''} onValueChange={onSelectJob}>
                    {jobOptions.map((option) => (
                      <DropdownMenuRadioItem key={option.id} value={option.id} disabled={!option.isActive}>
                        {option.title}
                        <DropdownMenuShortcut>{option.isActive ? 'active' : 'inactive'}</DropdownMenuShortcut>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!hasWorkflowIds}>
                    ID Sonar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[360px]">
                  <DropdownMenuLabel>Latest Workflow IDs (Click To Copy)</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {hasWorkflowIds ? (
                    workflowIdCatalog.entries.slice(0, 20).map((entry) => (
                      <DropdownMenuItem
                        key={`${entry.key}:${entry.value}`}
                        onSelect={() => void onCopyWorkflowId(entry)}
                      >
                        {formatWorkflowIdLabel(entry.key)}
                        <DropdownMenuShortcut>{formatWorkflowIdShortcut(entry.value)}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>No workflow IDs detected yet.</DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void onCopyAllWorkflowIds()}>
                    Copy IDs As JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                disabled={isChatBusy || isAuthorizationFlowRunning}
                onClick={onAuthorizeConnectionsOneByOne}
              >
                <HugeIcon icon={Key01Icon} size={16} strokeWidth={2.2} className="w-4 h-4 mr-1" />
                {isAuthorizationFlowRunning
                  ? `Authorizing ${activeAuthorizationStep ?? 'Integrations'}...`
                  : 'Authorize Integrations'}
              </Button>

              <Button variant="outline" size="sm" disabled={isChatBusy} onClick={onRunConnectionDiagnostics}>
                <HugeIcon icon={Activity01Icon} size={16} strokeWidth={2.2} className="w-4 h-4 mr-1" />
                Run Diagnostics
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isChatBusy}>
                    / Commands
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {OPERATOR_COMMAND_TEMPLATES.map((template) => (
                    <DropdownMenuItem
                      key={template.label}
                      onSelect={() => onInsertOperatorCommand(template.value)}
                    >
                      {template.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {isChatBusy ? (
                <Button variant="outline" size="sm" onClick={onStopGeneration}>
                  <HugeIcon icon={SquareIcon} size={16} strokeWidth={2.2} className="w-4 h-4 mr-1" />
                  Stop
                </Button>
              ) : null}

              {!isChatBusy && hasAssistantMessages ? (
                <Button variant="outline" size="sm" onClick={() => regenerate()}>
                  <HugeIcon icon={RefreshIcon} size={16} strokeWidth={2.2} className="w-4 h-4 mr-1" />
                  Regenerate
                </Button>
              ) : null}

              {messages.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isCopyingLogs}>
                      <HugeIcon icon={Copy01Icon} size={16} strokeWidth={2.2} className="w-4 h-4 mr-1" />
                      {isCopyingLogs ? 'Copying...' : 'Copy Logs'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void onCopyLogs('latest_exchange')}>
                      Latest You + AI Exchange
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void onCopyLogs('full_session')}>
                      Full Session (All Messages)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {messages.length > 0 ? (
                <Button variant="outline" size="sm" onClick={onClearChat}>
                  <HugeIcon icon={Delete02Icon} size={16} strokeWidth={2.2} className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="max-w-[768px] mx-auto mb-3 text-xs text-muted-foreground px-1">
              {selectedJob
                ? `Selected active job: ${selectedJob.title} (${selectedJob.id}).`
                : hasActiveJobOptions
                  ? 'Pick an active job to use as the default for intake, scheduling, and offer workflows.'
                  : 'No active jobs found yet. Run `npm run seed:demo -- --reset` or activate a job in the database first.'}
              {' '}Use ID Sonar to copy IDs and / Commands to auto-fill available placeholders.
            </p>
            <ChatInput
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onSubmit={onSubmit}
              loading={isChatBusy}
              placeholder={props.placeholder ?? 'What can I help you with?'}
            ></ChatInput>
          </div>
        }
      ></StickyToBottomContent>
    </StickToBottom>
  );
}
