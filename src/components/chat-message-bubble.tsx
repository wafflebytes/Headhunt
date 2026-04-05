import { type UIMessage } from 'ai';
import { Alert02Icon, CheckmarkCircle02Icon, Loading03Icon } from '@hugeicons/core-free-icons';

import { HugeIcon } from '@/components/ui/huge-icon';
import { MemoizedMarkdown } from './memoized-markdown';
import { cn } from '@/utils/cn';

export type ToolCallStatus = 'pending' | 'complete' | 'error';

export type ToolCallTimingInfo = {
  startedAt: number;
  completedAt?: number;
  status: ToolCallStatus;
};

type ToolCallView = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: ToolCallStatus;
  resultCheck?: string | null;
  resultStatus?: string | null;
  resultMode?: string | null;
  elapsedMs?: number;
};

const MANUAL_REVIEW_REASON_LABELS: Record<string, string> = {
  missing_sender_email: 'Sender email is missing or unparsable',
  low_identity_confidence: 'Identity extraction confidence is too low',
  missing_job_context: 'No active job context was resolved',
  low_confidence_application: 'Triage confidence is too low for auto-routing',
  ambiguous_job_match: 'Message maps to multiple jobs',
  ambiguous_candidate_email_match: 'Multiple candidates match the same job/email',
  candidate_not_found_for_scheduling_reply: 'No candidate matched scheduling reply context',
  candidate_stage_already_advanced: 'Candidate has already advanced beyond scheduling stage',
  missing_prior_availability_request: 'No prior availability request context was found',
  reply_thread_mismatch: 'Reply arrived on a different thread than the request',
  reply_not_newer_than_request: 'Reply timestamp is not newer than latest request',
  uncertain_input: 'Input remains uncertain for safe automation',
  non_actionable_irrelevant: 'Message is irrelevant to recruiting workflow',
};

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function prettifyReasonCode(reasonCode: string): string {
  const mapped = MANUAL_REVIEW_REASON_LABELS[reasonCode];
  if (mapped) {
    return mapped;
  }

  return reasonCode.replace(/_/g, ' ').trim();
}

function isManualReviewResult(result: unknown): boolean {
  const record = asRecord(result);
  if (!record) {
    return false;
  }

  if (record.manualReviewRequired === true) {
    return true;
  }

  return asNonEmptyString(record.boundary) === 'manual_review_required';
}

function getToolOutputTone(result: unknown, status: ToolCallStatus): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'error') {
    return 'error';
  }

  const record = asRecord(result);
  if (!record) {
    return status === 'complete' ? 'success' : 'neutral';
  }

  const normalizedStatus = asNonEmptyString(record.status)?.toLowerCase();
  if (normalizedStatus === 'error' || normalizedStatus === 'failed' || normalizedStatus === 'denied') {
    return 'error';
  }

  if (isManualReviewResult(result)) {
    return 'warning';
  }

  if (normalizedStatus === 'success' || normalizedStatus === 'healthy' || normalizedStatus === 'completed') {
    return 'success';
  }

  return status === 'complete' ? 'success' : 'neutral';
}

function toolOutputPanelClass(tone: 'success' | 'warning' | 'error' | 'neutral'): string {
  if (tone === 'error') {
    return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100';
  }

  if (tone === 'warning') {
    return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100';
  }

  if (tone === 'success') {
    return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100';
  }

  return 'bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100';
}

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
    const toolError = partRecord?.error ?? partRecord?.errorText ?? toolInvocation?.error ?? toolInvocation?.errorText;

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
      if (toolError !== undefined && existing.result === undefined) {
        existing.result = typeof toolError === 'string' ? { message: toolError } : toolError;
      }
    }

    if (partType === 'tool-result') {
      existing.status = 'complete';
      if (partRecord?.output !== undefined) {
        existing.result = partRecord.output;
      }
    }

    const metadata = getToolResultMetadata(existing.result);
    existing.resultCheck = metadata.check;
    existing.resultStatus = metadata.status;
    existing.resultMode = metadata.mode;

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
  if (typeof maybeMessage === 'string' && /authorization required to access the token vault/i.test(maybeMessage)) {
    return 'Authorization is required for this integration. Use the Authorize popup (or Authorize Integrations), then rerun the same command.';
  }

  const maybeCheck = asNonEmptyString((result as { check?: unknown }).check);
  const maybeStatus = asNonEmptyString((result as { status?: unknown }).status);

  if (maybeCheck === 'automation_context' && asNonEmptyString((result as { boundary?: unknown }).boundary) === 'manual_review_required') {
    const contextMessage = asNonEmptyString(maybeMessage) ?? 'Required context is missing for safe automation.';
    return `Manual review required: ${contextMessage}`;
  }

  if (maybeCheck === 'run_intake_e2e' && maybeStatus === 'success') {
    const processedCount = asNumber((result as { processedCount?: unknown }).processedCount) ?? 0;
    const ingestedCreated = asNumber((result as { ingestedCreated?: unknown }).ingestedCreated) ?? 0;
    const ingestedIdempotent = asNumber((result as { ingestedIdempotent?: unknown }).ingestedIdempotent) ?? 0;
    const uncertainManualReviewCount =
      asNumber((result as { uncertainManualReviewCount?: unknown }).uncertainManualReviewCount) ?? 0;
    const ambiguousIdentityCount =
      asNumber((result as { ambiguousIdentityCount?: unknown }).ambiguousIdentityCount) ?? 0;

    const lines = [
      `Intake run processed ${processedCount} message${processedCount === 1 ? '' : 's'}.`,
      `Created candidates: ${ingestedCreated}. Idempotent matches: ${ingestedIdempotent}.`,
    ];

    if (uncertainManualReviewCount > 0) {
      lines.push(`Manual review required for ${uncertainManualReviewCount} message${uncertainManualReviewCount === 1 ? '' : 's'}.`);

      const messages = Array.isArray((result as { messages?: unknown }).messages)
        ? ((result as { messages?: unknown }).messages as unknown[])
        : [];
      const reasonCounts = new Map<string, number>();

      messages.forEach((entry) => {
        const row = asRecord(entry);
        if (!row) {
          return;
        }

        const reasonCode = asNonEmptyString(row.reasonCode);
        if (!reasonCode) {
          return;
        }

        reasonCounts.set(reasonCode, (reasonCounts.get(reasonCode) ?? 0) + 1);
      });

      const topReasons = Array.from(reasonCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([reasonCode, count]) => `${prettifyReasonCode(reasonCode)} (${count})`);

      if (topReasons.length > 0) {
        lines.push(`Top boundary reasons: ${topReasons.join('; ')}.`);
      }
    }

    if (ambiguousIdentityCount > 0) {
      lines.push(`Ambiguous identity matches: ${ambiguousIdentityCount}.`);
    }

    return lines.join('\n');
  }

  if (isManualReviewResult(result)) {
    const manualReviewReason =
      asNonEmptyString((result as { manualReviewReason?: unknown }).manualReviewReason) ??
      asNonEmptyString((result as { reason?: unknown }).reason) ??
      asNonEmptyString(maybeMessage);
    const boundaryReason =
      asNonEmptyString((result as { reasonCode?: unknown }).reasonCode) ??
      asNonEmptyString((result as { boundaryReason?: unknown }).boundaryReason);
    const suggestedAction = asNonEmptyString((result as { suggestedAction?: unknown }).suggestedAction);

    const lines = ['Manual review required before continuing automation.'];
    if (manualReviewReason) {
      lines.push(`Reason: ${manualReviewReason}`);
    }
    if (boundaryReason) {
      lines.push(`Boundary: ${prettifyReasonCode(boundaryReason)}`);
    }
    if (suggestedAction) {
      lines.push(`Suggested next step: ${suggestedAction.replace(/_/g, ' ')}`);
    }

    return lines.join('\n');
  }

  if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
    return maybeMessage.trim();
  }

  const continueInterruption = (result as { continueInterruption?: unknown }).continueInterruption;
  if (continueInterruption === true) {
    return 'Authorization is required to continue. Click Authorize in the popup.';
  }

  const transcriptCheck = (result as { check?: unknown }).check;
  const transcriptStatus = (result as { status?: unknown }).status;
  if (transcriptCheck === 'run_multi_agent_candidate_score') {
    if (transcriptStatus === 'error') {
      const message = asNonEmptyString((result as { message?: unknown }).message) ?? 'Unknown consensus scoring error.';
      return `Multi-agent candidate scoring failed: ${message}`;
    }

    if (transcriptStatus === 'success') {
      const consensus = asRecord((result as { consensus?: unknown }).consensus);
      const agentScores = asRecord((result as { agentScores?: unknown }).agentScores);

      const recommendation = asNonEmptyString(consensus?.recommendation);
      const finalScore = typeof consensus?.finalScore === 'number' ? consensus.finalScore : null;
      const confidence = typeof consensus?.confidence === 'number' ? consensus.confidence : null;

      const technical = typeof agentScores?.technical === 'number' ? agentScores.technical : null;
      const social = typeof agentScores?.social === 'number' ? agentScores.social : null;
      const atsObjective = typeof agentScores?.atsObjective === 'number' ? agentScores.atsObjective : null;

      const strengths = Array.isArray(consensus?.strengths) ? consensus.strengths : [];
      const risks = Array.isArray(consensus?.risks) ? consensus.risks : [];

      const lines = ['Multi-agent candidate scoring completed.'];
      if (typeof finalScore === 'number') {
        lines.push(`Final consensus score: ${finalScore}/100`);
      }
      if (typeof confidence === 'number') {
        lines.push(`Confidence: ${confidence}/100`);
      }
      if (recommendation) {
        lines.push(`Recommendation: ${recommendation}`);
      }

      const evaluatorParts = [
        typeof technical === 'number' ? `technical ${technical}` : null,
        typeof social === 'number' ? `social ${social}` : null,
        typeof atsObjective === 'number' ? `ats objective ${atsObjective}` : null,
      ].filter((part): part is string => Boolean(part));

      if (evaluatorParts.length > 0) {
        lines.push(`Evaluator scores: ${evaluatorParts.join(', ')}`);
      }

      if (strengths.length > 0 && typeof strengths[0] === 'string') {
        lines.push(`Top strength: ${strengths[0]}`);
      }

      if (risks.length > 0 && typeof risks[0] === 'string') {
        lines.push(`Top risk: ${risks[0]}`);
      }

      return lines.join('\n');
    }
  }

  if (
    (transcriptCheck === 'summarize_cal_booking_transcript' ||
      transcriptCheck === 'summarize_drive_transcript_pdf') &&
    transcriptStatus === 'success'
  ) {
    const summary = asRecord((result as { summary?: unknown }).summary);
    const recommendation = asNonEmptyString(summary?.recommendation);
    const score = summary?.overallRubricScore;
    const strengths = Array.isArray(summary?.candidateStrengths) ? summary?.candidateStrengths : [];
    const risks = Array.isArray(summary?.candidateRisks) ? summary?.candidateRisks : [];

    const lines = ['Interview transcript summary generated.'];
    if (recommendation) {
      lines.push(`Recommendation: ${recommendation}`);
    }
    if (typeof score === 'number' && Number.isFinite(score)) {
      lines.push(`Rubric score: ${score}/30`);
    }
    if (strengths.length > 0 && typeof strengths[0] === 'string') {
      lines.push(`Top strength: ${strengths[0]}`);
    }
    if (risks.length > 0 && typeof risks[0] === 'string') {
      lines.push(`Top risk: ${risks[0]}`);
    }

    return lines.join('\n');
  }

  const check = (result as { check?: unknown }).check;
  const status = (result as { status?: unknown }).status;
  if (typeof check === 'string' && typeof status === 'string') {
    const readableCheck = check.replace(/^verify_/, '').replace(/_/g, ' ').trim();
    const normalizedStatus = status.trim().toLowerCase();
    const healthyStatuses = new Set(['healthy', 'success', 'complete', 'approved', 'sent']);
    const needsAttentionStatuses = new Set(['error', 'failed', 'denied', 'unhealthy']);
    const readableStatus = healthyStatuses.has(normalizedStatus)
      ? 'healthy'
      : needsAttentionStatuses.has(normalizedStatus)
        ? 'needs attention'
        : status;
    return `${readableCheck}: ${readableStatus}.`;
  }

  return null;
}

function getToolResultMetadata(result: unknown): {
  check: string | null;
  status: string | null;
  mode: string | null;
} {
  const record = asRecord(result);
  if (!record) {
    return {
      check: null,
      status: null,
      mode: null,
    };
  }

  return {
    check: asNonEmptyString(record.check),
    status: asNonEmptyString(record.status),
    mode: asNonEmptyString(record.mode),
  };
}

function normalizeStatusLabel(value: string): string {
  return value.replace(/_/g, ' ').trim();
}

function statusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();

  if (
    normalized.includes('error') ||
    normalized.includes('failed') ||
    normalized.includes('denied') ||
    normalized.includes('expired') ||
    normalized.includes('unhealthy')
  ) {
    return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300';
  }

  if (
    normalized.includes('pending') ||
    normalized.includes('awaiting') ||
    normalized.includes('running') ||
    normalized.includes('queued')
  ) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }

  if (
    normalized.includes('success') ||
    normalized.includes('healthy') ||
    normalized.includes('sent') ||
    normalized.includes('approved') ||
    normalized.includes('complete')
  ) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }

  return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
}

function formatElapsed(elapsedMs: number | undefined): string | null {
  if (typeof elapsedMs !== 'number' || Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return null;
  }

  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)} ms`;
  }

  return `${(elapsedMs / 1000).toFixed(1)} s`;
}

function summarizeToolOutput(toolCall: ToolCallView): string {
  const scheduleSummary = formatScheduleToolResult(toolCall.result);
  if (scheduleSummary) {
    return scheduleSummary;
  }

  const genericSummary = summarizeToolResult(toolCall.result);
  if (genericSummary) {
    return genericSummary;
  }

  if (toolCall.result === undefined) {
    return '';
  }

  if (typeof toolCall.result === 'string') {
    return toolCall.result;
  }

  try {
    return JSON.stringify(toolCall.result, null, 2);
  } catch {
    return String(toolCall.result);
  }
}

function formatScheduleToolResult(result: unknown): string | null {
  const resultRecord = asRecord(result);
  if (!resultRecord) {
    return null;
  }

  const check = asNonEmptyString(resultRecord.check);
  if (check === 'run_final_schedule_flow') {
    const status = asNonEmptyString(resultRecord.status);
    const mode = asNonEmptyString(resultRecord.mode);

    if (status === 'error') {
      const message = asNonEmptyString(resultRecord.message) ?? 'Unknown final scheduling error.';
      return `Final scheduling failed: ${message}`;
    }

    if (status !== 'success') {
      return null;
    }

    if (mode === 'request_sent' || mode === 'request_drafted') {
      const candidateEmail = asNonEmptyString(resultRecord.candidateEmail);
      const threadId = asNonEmptyString(resultRecord.threadId);
      const requestRecord = asRecord(resultRecord.request);
      const slotOptionsRaw = Array.isArray(requestRecord?.slotOptions) ? requestRecord?.slotOptions : [];
      const lines = [
        mode === 'request_sent'
          ? 'Availability request sent to candidate.'
          : 'Availability request drafted for candidate.',
      ];

      if (candidateEmail) {
        lines.push(`Candidate email: ${candidateEmail}`);
      }

      if (threadId) {
        lines.push(`Thread ID: ${threadId}`);
      }

      if (slotOptionsRaw.length > 0) {
        lines.push('Proposed slots:');
        slotOptionsRaw.slice(0, 4).forEach((slotRaw, index) => {
          const slot = asRecord(slotRaw);
          const displayLabel = asNonEmptyString(slot?.displayLabel);
          if (displayLabel) {
            lines.push(`${index + 1}. ${displayLabel}`);
          }
        });
      }

      return lines.join('\n');
    }

    if (mode === 'waiting_for_candidate_reply') {
      const candidateEmail = asNonEmptyString(resultRecord.candidateEmail);
      const threadId = asNonEmptyString(resultRecord.threadId);
      const lines = ['Waiting for candidate availability reply.'];

      if (candidateEmail) {
        lines.push(`Candidate email: ${candidateEmail}`);
      }

      if (threadId) {
        lines.push(`Thread ID: ${threadId}`);
      }

      return lines.join('\n');
    }

    if (mode === 'scheduled') {
      const eventRecord = asRecord(resultRecord.event);
      const overlapRecord = asRecord(resultRecord.overlap);
      const bookingUid = asNonEmptyString(eventRecord?.bookingUid);
      const displayLabel = asNonEmptyString(overlapRecord?.displayLabel);
      const meetLink = asNonEmptyString(eventRecord?.meetLink);
      const location = asNonEmptyString(eventRecord?.location);

      const lines = ['Final scheduling flow completed: Cal booking created.'];

      if (bookingUid) {
        lines.push(`Booking ID: ${bookingUid}`);
      }

      if (displayLabel) {
        lines.push(`Slot: ${displayLabel}`);
      }

      if (location) {
        lines.push(`Location: ${location}`);
      }

      if (meetLink) {
        lines.push(`Meet link: ${meetLink}`);
      }

      return lines.join('\n');
    }

    return null;
  }

  if (check !== 'schedule_interview_slots' && check !== 'schedule_with_cal') {
    return null;
  }

  const status = asNonEmptyString(resultRecord.status);
  const mode = asNonEmptyString(resultRecord.mode);

  if (status === 'error') {
    const message = asNonEmptyString(resultRecord.message) ?? 'Unknown scheduling error.';
    return `Scheduling failed: ${message}`;
  }

  if (status !== 'success') {
    return null;
  }

  if (mode === 'propose') {
    const recoveryRecord = asRecord(resultRecord.recovery);
    const recoveryMessage = asNonEmptyString(recoveryRecord?.message);
    const recoveryReason = asNonEmptyString(recoveryRecord?.reason);

    const slotsValue = resultRecord.slots;
    const slots = Array.isArray(slotsValue) ? slotsValue : [];
    const recommendedRaw = resultRecord.recommendedSlotIndex;
    const recommendedIndex =
      typeof recommendedRaw === 'number' && Number.isInteger(recommendedRaw) ? recommendedRaw : -1;

    const slotLines = slots
      .map((slot, index) => {
        const slotRecord = asRecord(slot);
        if (!slotRecord) {
          return null;
        }

        const displayLabel = asNonEmptyString(slotRecord.displayLabel);
        const startISO = asNonEmptyString(slotRecord.startISO);
        if (!displayLabel || !startISO) {
          return null;
        }

        const suffix = index === recommendedIndex ? ' (recommended)' : '';
        return `${index + 1}. ${displayLabel}${suffix}\n   selectedStartISO: \"${startISO}\"`;
      })
      .filter((line): line is string => Boolean(line));

    const intro =
      recoveryMessage ??
      (recoveryReason === 'stale_selected_start_iso'
        ? 'Selected slot was stale. Here are refreshed interview slots.'
        : 'Interview slots proposed successfully.');

    if (slotLines.length === 0) {
      return `${intro}\n\nNo available slots were returned in the current window.`;
    }

    const recommendedSlot =
      recommendedIndex >= 0 && recommendedIndex < slots.length ? asRecord(slots[recommendedIndex]) : null;
    const recommendedStartISO = recommendedSlot ? asNonEmptyString(recommendedSlot.startISO) : null;

    const confirmHint = recommendedStartISO
      ? `Reply with selectedStartISO \"${recommendedStartISO}\" to confirm scheduling.`
      : 'Reply with the chosen selectedStartISO value to confirm scheduling.';

    return `${intro}\n\n${slotLines.join('\n')}\n\n${confirmHint}`;
  }

  if (mode === 'schedule') {
    const provider = asNonEmptyString(resultRecord.provider);
    const eventRecord = asRecord(resultRecord.event);
    const bookingUid = asNonEmptyString(eventRecord?.bookingUid);
    const displayLabel = asNonEmptyString(eventRecord?.displayLabel);
    const startISO = asNonEmptyString(eventRecord?.startISO);
    const endISO = asNonEmptyString(eventRecord?.endISO);
    const meetLink = asNonEmptyString(eventRecord?.meetLink);
    const location = asNonEmptyString(eventRecord?.location);
    const htmlLink = asNonEmptyString(eventRecord?.htmlLink);

    const lines = [
      provider === 'cal' ? 'Interview scheduled successfully via Cal.com.' : 'Interview scheduled successfully.',
    ];

    if (bookingUid) {
      lines.push(`Booking ID: ${bookingUid}`);
    }

    if (displayLabel) {
      lines.push(`Slot: ${displayLabel}`);
    } else if (startISO && endISO) {
      lines.push(`Slot: ${startISO} -> ${endISO}`);
    }

    if (location) {
      lines.push(`Location: ${location}`);
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

function formatToolErrorSummary(toolCall: ToolCallView): string | null {
  if (toolCall.status !== 'error') {
    return null;
  }

  const detail = summarizeToolResult(toolCall.result);
  if (detail) {
    return `${toolCall.toolName} failed: ${detail}`;
  }

  return `${toolCall.toolName} failed. See tool output above.`;
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
  const { toolName, args, result, status, resultStatus, elapsedMs } = toolCall;
  const elapsed = formatElapsed(elapsedMs);
  const runtimeStatusLabel =
    status === 'pending' ? 'running' : status === 'complete' ? 'completed' : 'failed';
  const outputSummary = summarizeToolOutput(toolCall);
  const hasRawObjectOutput = result !== undefined && typeof result === 'object' && result !== null;
  const normalizedResultStatus = resultStatus ? normalizeStatusLabel(resultStatus) : null;
  const outputTone = getToolOutputTone(result, status);

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-600">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center flex-wrap gap-2">
          {status === 'pending' && <HugeIcon icon={Loading03Icon} size={16} strokeWidth={2.2} className="w-4 h-4 animate-spin text-blue-500" />}
          {status === 'complete' && <HugeIcon icon={CheckmarkCircle02Icon} size={16} strokeWidth={2.2} className="w-4 h-4 text-green-500" />}
          {status === 'error' && <HugeIcon icon={Alert02Icon} size={16} strokeWidth={2.2} className="w-4 h-4 text-red-500" />}

          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{toolName}</span>

          <span
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide',
              statusBadgeClass(runtimeStatusLabel),
            )}
          >
            {runtimeStatusLabel}
          </span>

          {normalizedResultStatus ? (
            <span
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide',
                statusBadgeClass(normalizedResultStatus),
              )}
            >
              result: {normalizedResultStatus}
            </span>
          ) : null}
        </div>

        {elapsed ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200">
            elapsed: {elapsed}
          </span>
        ) : null}
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
          <div className={cn('rounded px-3 py-2 text-xs border whitespace-pre-wrap', toolOutputPanelClass(outputTone))}>
            {outputSummary || '(no output details)'}
          </div>

          {hasRawObjectOutput ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-600 dark:text-gray-300">Raw output JSON</summary>
              <pre className="mt-2 bg-white dark:bg-gray-900 rounded px-3 py-2 text-xs font-mono border border-gray-200 dark:border-gray-700 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ChatMessageBubble(props: {
  message: UIMessage;
  aiEmoji?: string;
  toolTimingByKey?: Record<string, ToolCallTimingInfo>;
  nowMs?: number;
}) {
  const { message, aiEmoji, toolTimingByKey, nowMs } = props;
  const toolCalls = getToolCallsFromMessage(message).map((toolCall) => {
    const timing = toolTimingByKey ? toolTimingByKey[`${message.id}:${toolCall.toolCallId}`] : undefined;

    return {
      ...toolCall,
      status: timing?.status ?? toolCall.status,
      elapsedMs: timing ? Math.max(0, (timing.completedAt ?? nowMs ?? Date.now()) - timing.startedAt) : undefined,
    };
  });
  const authoritativeScheduleText =
    message.role === 'assistant'
      ? [...toolCalls]
          .reverse()
          .filter(
            (toolCall) =>
              (toolCall.toolName === 'schedule_interview_slots' ||
                toolCall.toolName === 'schedule_interview_with_cal') &&
              toolCall.status === 'complete',
          )
          .map((toolCall) => formatScheduleToolResult(toolCall.result))
          .find((value): value is string => Boolean(value)) ?? ''
      : '';
  const authoritativeToolErrorText =
    message.role === 'assistant'
      ? [...toolCalls]
          .reverse()
          .map((toolCall) => formatToolErrorSummary(toolCall))
          .find((value): value is string => Boolean(value)) ?? ''
      : '';
  const text = message.role === 'assistant' ? sanitizeAssistantText(uiMessageToText(message)) : uiMessageToText(message);
  const hideStubText = message.role === 'assistant' && isLikelyAssistantStub(text);
  const renderedText = authoritativeScheduleText || authoritativeToolErrorText || (hideStubText ? '' : text);
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
