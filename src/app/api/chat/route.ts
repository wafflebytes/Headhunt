import { NextRequest, NextResponse } from 'next/server';
import {
  streamText,
  type UIMessage,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
} from 'ai';
import { setAIContext } from '@auth0/ai-vercel';
import { errorSerializer, withInterruptions } from '@auth0/ai-vercel/interrupts';
import { nim, nimChatModelId } from '@/lib/nim';
import { auth0 } from '@/lib/auth0';

import { serpApiTool } from '@/lib/tools/serpapi';
import { getUserInfoTool } from '@/lib/tools/user-info';
import { gmailDraftTool, gmailSearchTool } from '@/lib/tools/gmail';
import { getCalendarEventsTool } from '@/lib/tools/google-calender';
import { getTasksTool, createTasksTool } from '@/lib/tools/google-tasks';
import { shopOnlineTool } from '@/lib/tools/shop-online';
import { getContextDocumentsTool } from '@/lib/tools/context-docs';
import { listRepositories } from '@/lib/tools/list-gh-repos';
import { listGitHubEvents } from '@/lib/tools/list-gh-events';
import { listSlackChannels } from '@/lib/tools/list-slack-channels';
import {
  runConnectionDiagnosticsTool,
  verifyCalConnectionTool,
  verifyCalendarConnectionTool,
  verifyGoogleConnectionTool,
  verifyGmailReadConnectionTool,
  verifyGmailSendConnectionTool,
  verifySlackConnectionTool,
} from '@/lib/tools/connection-diagnostics';
import { runIntakeE2ETool } from '@/lib/tools/intake-e2e';
import { runInterceptTool } from '@/lib/tools/intercept';
import {
  analyzeCandidateSchedulingReplyTool,
  parseCandidateAvailabilityTool,
  runFinalScheduleFlowTool,
  scheduleInterviewSlotsTool,
  sendInterviewProposalTool,
  sendInterviewConfirmationTool,
} from '@/lib/tools/scheduling';
import { scheduleInterviewWithCalTool } from '@/lib/tools/cal-scheduling';
import {
  summarizeCalBookingTranscriptTool,
  summarizeDriveTranscriptPdfTool,
} from '@/lib/tools/interview-transcripts';
import {
  draftOfferLetterTool,
  pollOfferClearanceTool,
  submitOfferForClearanceTool,
} from '@/lib/tools/offers';
import { runMultiAgentCandidateScoreTool } from '@/lib/tools/multi-agent-candidate-score';
import { generateIntelCardTool, runTriageTool } from '@/lib/tools/triage-intel';

const date = new Date().toISOString();

const AGENT_SYSTEM_TEMPLATE = `You are a personal assistant named Assistant0. You are a helpful assistant that can answer questions and help with tasks. 
You have access to a set of tools. When using tools, you MUST provide valid JSON arguments. Always format tool call arguments as proper JSON objects.
For example, when calling shop_online tool, format like this:
{"product": "iPhone", "qty": 1, "priceLimit": 1000}
Use the tools as needed to answer the user's question. Render the email body as a markdown block, do not wrap it in code blocks.
Never output raw serialized tool payloads such as "functions.tool_name:1{}" or "[{'type': 'text', 'text': '...'}]". Always return plain-language text.
Never output tool marker tokens like "<|tool_call_end|>" or "<|tool_calls_section_end|>".
When you plan to call a tool, do not send short placeholder text like "I'll" or "Let me" by itself. Call the tool first, then provide a complete summary.
The current date and time is ${date}.`;

const DIAGNOSTICS_INSTRUCTIONS = `
When the user asks to run connection diagnostics, or sends "run_connection_diagnostics", call only run_connection_diagnostics and summarize the checks.
If any check is unhealthy, include exact missing connection/scope details and what to authorize next.

If the user sends an authorize_connections_step directive, call exactly one tool and do not call any others:
- authorize_connections_step:google -> verify_google_connection
- authorize_connections_step:gmail_read -> verify_gmail_read_connection
- authorize_connections_step:gmail_send -> verify_gmail_send_connection
- authorize_connections_step:calendar -> verify_calendar_connection
- authorize_connections_step:cal -> verify_cal_connection
- authorize_connections_step:slack -> verify_slack_connection

When diagnostics show any Google check as unhealthy, recommend authorize_connections_step:google as the next step.
`;

const TRIAGE_INTEL_INSTRUCTIONS = `
When the user asks for a "true end-to-end intake run", call run_intake_e2e.
When calling run_intake_e2e from a direct command, do not invent organizationId or jobId. Only use ids explicitly provided by the user.
When asked to pull candidate-like recruiting emails from Gmail intake, call run_intercept.
When asked to classify hiring/recruiting emails, call run_triage.
When asked to generate a candidate intel card, call generate_intel_card.
When asked to run three-evaluator consensus candidate scoring (technical + social + ATS objective), call run_multi_agent_candidate_score.
When asked to parse candidate availability text into structured windows, call parse_candidate_availability.
When asked to send interview slot options explicitly, call send_interview_proposal.
When asked to ask candidate for their own availability windows and then auto-book from Cal overlap, call run_final_schedule_flow.
When asked to analyze a candidate scheduling reply from Gmail, call analyze_candidate_scheduling_reply.
When asked to schedule with Cal booking APIs, call schedule_with_cal.
When asked to run the final scheduling flow (request candidate windows, analyze reply, overlap with Cal, auto-book), call run_final_schedule_flow.
When asked to send an interview confirmation email, call send_interview_confirmation.
For Cal-managed bookings, do not send a duplicate founder confirmation email; Cal already sends invite/booking notifications.
When asked to summarize interview transcript from a Cal booking, call summarize_cal_booking_transcript with bookingUid.
If Cal transcript retrieval fails or returns no transcript text, call summarize_drive_transcript_pdf using driveFileId, driveQuery, driveFolderId, or driveFolderName as fallback.
When asked to draft an offer letter with terms, call draft_offer_letter.
When asked to propose interview slots or schedule an interview, call schedule_interview_slots.
When summarizing schedule_interview_slots output, be exact:
- If output.mode is "propose", say slots were proposed only and ask for selectedStartISO confirmation.
- If output.recovery.reason is "stale_selected_start_iso", explicitly note the selected slot was stale and that fresh slots were returned.
- If output.mode is "schedule", say the interview was scheduled and include event details.
- If output.status is "error", report only the error and do not claim success.
When summarizing send_interview_confirmation output:
- If output.mode is "draft", say a confirmation draft was created and not sent.
- If output.mode is "send", say confirmation was sent and include providerId/thread id when present.
- If output.mode is "skipped", say no founder email was sent because Cal already sends booking emails.
- If output.status is "error", report only the error and do not claim success.
When summarizing run_final_schedule_flow output:
- If output.mode is "request_sent" or "request_drafted", say Cal free slots were fetched and sent/drafted as candidate options; include candidate email/thread id.
- If output.mode is "waiting_for_candidate_reply", say flow is waiting for candidate availability reply and do not claim booking.
- If output.mode is "scheduled", say Cal booking is complete and include overlap slot + booking id/link when present.
- If output.status is "error", report only the error and do not claim success.
When summarizing summarize_cal_booking_transcript or summarize_drive_transcript_pdf output:
- If output.status is "success", include recommendation, overallRubricScore, top strengths, top risks, and top actionableFollowUps.
- If output.status is "error", report only the error and mention fallback if provided in output.fallback.
When summarizing draft_offer_letter output:
- If output.mode is "create", say a new offer draft was created.
- If output.mode is "update", say the existing draft was updated.
- Include offerId and key terms (salary, currency, start date) from output.offer.terms.
- If output.status is "error", report only the error and do not claim success.
When summarizing run_multi_agent_candidate_score output:
- If output.status is "success", include final consensus score, confidence, recommendation, and per-evaluator scores.
- If output.status is "error", report only the error and do not claim success.
When generating intel, persist outputs and move candidate/application stage to reviewed.
`;

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    const maybeText = (error as { text?: unknown }).text;
    if (typeof maybeText === 'string' && maybeText.trim()) {
      return maybeText;
    }

    const maybeError = (error as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim()) {
      return maybeError;
    }

    const maybeCause = (error as { cause?: unknown }).cause;
    if (maybeCause) {
      const causeMessage = extractErrorMessage(maybeCause);
      if (causeMessage !== 'Unknown error') {
        return causeMessage;
      }
    }
  }

  return 'Unknown error';
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

type ForcedToolDecision = {
  toolChoice?: {
    type: 'tool';
    toolName: string;
  };
  forcedArgsInstruction?: string;
  forcedToolName?: string;
  forcedToolArgs?: Record<string, unknown>;
};

function parseCommandArgs(rawText: string): Record<string, string> {
  const trimmed = rawText.trim();
  const withIndex = trimmed.toLowerCase().indexOf(' with ');
  const slashCommandMatch = trimmed.match(/^\/[a-z0-9_-]+/i);

  let argsPortion = '';
  if (withIndex !== -1) {
    argsPortion = trimmed.slice(withIndex + 6);
  } else if (slashCommandMatch) {
    argsPortion = trimmed.slice(slashCommandMatch[0].length).trim();
  } else {
    argsPortion = trimmed;
  }

  const args: Record<string, string> = {};
  const pairPattern = /(\w+)\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match: RegExpExecArray | null = null;

  while ((match = pairPattern.exec(argsPortion)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (key && value) {
      args[key] = value;
    }
  }

  return args;
}

function compactArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value as Record<string, unknown>).length > 0;
      }

      return true;
    }),
  );
}

function resolveCandidateId(parsed: Record<string, string>): string | undefined {
  return parsed.candidateId ?? parsed.candidate;
}

function resolveJobId(parsed: Record<string, string>): string | undefined {
  return parsed.jobId ?? parsed.job;
}

function resolveOrganizationId(parsed: Record<string, string>): string | undefined {
  return parsed.organizationId ?? parsed.organization ?? parsed.orgId ?? parsed.org;
}

function buildForcedArgsInstruction(params: {
  toolName: string;
  commandDescription: string;
  args: Record<string, unknown>;
  allowEmptyArgs?: boolean;
  tailInstruction?: string;
}): string | undefined {
  const normalizedArgs = compactArgs(params.args);
  if (!params.allowEmptyArgs && Object.keys(normalizedArgs).length === 0) {
    return undefined;
  }

  return `\nFORCED_TOOL_ARGS: The user sent ${params.commandDescription}. You MUST call ${params.toolName} exactly once with this JSON object and do not omit provided fields:\n${JSON.stringify(
    normalizedArgs,
  )}${params.tailInstruction ? `\n${params.tailInstruction}` : ''}`;
}

function toNumberOrUndefined(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBooleanOrUndefined(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return undefined;
}

function toStringListOrUndefined(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function buildIntakeForcedArgsInstruction(rawText: string): string {
  const parsed = parseCommandArgs(rawText);
  const intakeArgs = {
    organizationId: resolveOrganizationId(parsed),
    jobId: resolveJobId(parsed),
    query: parsed.query,
    maxResults: toNumberOrUndefined(parsed.maxResults),
    processLimit: toNumberOrUndefined(parsed.processLimit),
    candidateLikeOnly: toBooleanOrUndefined(parsed.candidateLikeOnly),
    includeBody: toBooleanOrUndefined(parsed.includeBody),
    generateIntel: toBooleanOrUndefined(parsed.generateIntel),
  };

  const instruction = buildForcedArgsInstruction({
    toolName: 'run_intake_e2e',
    commandDescription: 'an explicit run_intake_e2e command',
    args: intakeArgs,
    allowEmptyArgs: true,
    tailInstruction: 'Do not infer or fabricate organizationId/jobId. If they are absent, call with {} and let the backend resolve defaults.',
  });

  return instruction ?? '';
}

function buildScheduleForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const scheduleArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    windowStartISO: parsed.windowStartISO,
    windowEndISO: parsed.windowEndISO,
    durationMinutes: toNumberOrUndefined(parsed.durationMinutes ?? parsed.duration),
    slotIntervalMinutes: toNumberOrUndefined(parsed.slotIntervalMinutes ?? parsed.slotInterval),
    maxSuggestions: toNumberOrUndefined(parsed.maxSuggestions),
    selectedStartISO: parsed.selectedStartISO,
    timezone: parsed.timezone,
  };

  return buildForcedArgsInstruction({
    toolName: 'schedule_interview_slots',
    commandDescription: 'an explicit schedule_interview_slots command',
    args: scheduleArgs,
    tailInstruction: 'Do not replace or drop selectedStartISO when it is present.',
  });
}

function buildParseAvailabilityForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const availabilityArgs = {
    availabilityText: parsed.availabilityText,
    candidateId: resolveCandidateId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    referenceDateISO: parsed.referenceDateISO,
    timezone: parsed.timezone,
  };

  return buildForcedArgsInstruction({
    toolName: 'parse_candidate_availability',
    commandDescription: 'an explicit parse_candidate_availability command',
    args: availabilityArgs,
  });
}

function buildSendInterviewConfirmationForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const confirmationArgs = {
    interviewId: parsed.interviewId,
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    subject: parsed.subject,
    customMessage: parsed.customMessage,
    sendMode: parsed.sendMode,
    timezone: parsed.timezone,
  };

  return buildForcedArgsInstruction({
    toolName: 'send_interview_confirmation',
    commandDescription: 'an explicit send_interview_confirmation command',
    args: confirmationArgs,
  });
}

function buildDraftOfferLetterForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const baseSalary = toNumberOrUndefined(parsed.baseSalary);
  const equityPercent = toNumberOrUndefined(parsed.equityPercent);
  const signOnBonus = toNumberOrUndefined(parsed.signOnBonus);
  const bonusTargetPercent = toNumberOrUndefined(parsed.bonusTargetPercent);

  const terms = {
    ...(typeof baseSalary === 'number' ? { baseSalary } : {}),
    ...(parsed.currency ? { currency: parsed.currency.toUpperCase() } : {}),
    ...(parsed.startDate ? { startDate: parsed.startDate } : {}),
    ...(typeof equityPercent === 'number' ? { equityPercent } : {}),
    ...(typeof signOnBonus === 'number' ? { signOnBonus } : {}),
    ...(typeof bonusTargetPercent === 'number' ? { bonusTargetPercent } : {}),
    ...(parsed.notes ? { notes: parsed.notes } : {}),
  };

  const offerArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    templateId: parsed.templateId,
    terms,
  };

  return buildForcedArgsInstruction({
    toolName: 'draft_offer_letter',
    commandDescription: 'an explicit draft_offer_letter command',
    args: offerArgs,
  });
}

function buildSubmitOfferForClearanceForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const submitArgs = {
    offerId: parsed.offerId,
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    founderUserId: parsed.founderUserId,
    requestedExpirySeconds: toNumberOrUndefined(parsed.requestedExpirySeconds),
    forceReissue: toBooleanOrUndefined(parsed.forceReissue),
  };

  return buildForcedArgsInstruction({
    toolName: 'submit_offer_for_clearance',
    commandDescription: 'an explicit submit_offer_for_clearance command',
    args: submitArgs,
  });
}

function buildPollOfferClearanceForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const pollArgs = {
    offerId: parsed.offerId,
    authReqId: parsed.authReqId,
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    founderUserId: parsed.founderUserId,
    allowSystemBypass: toBooleanOrUndefined(parsed.allowSystemBypass),
  };

  return buildForcedArgsInstruction({
    toolName: 'poll_offer_clearance',
    commandDescription: 'an explicit poll_offer_clearance command',
    args: pollArgs,
  });
}

function buildMultiAgentCandidateScoreForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const scoreArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    emailText: parsed.emailText,
    resumeText: parsed.resumeText,
    externalContext: parsed.externalContext,
    turns: toNumberOrUndefined(parsed.turns),
    maxEvidenceChars: toNumberOrUndefined(parsed.maxEvidenceChars),
    requirements: toStringListOrUndefined(parsed.requirements ?? parsed.requirementList),
  };

  return buildForcedArgsInstruction({
    toolName: 'run_multi_agent_candidate_score',
    commandDescription: 'an explicit multi-agent candidate scoring command',
    args: scoreArgs,
  });
}

function buildSendInterviewProposalForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const proposalArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    subject: parsed.subject,
    customMessage: parsed.customMessage,
    schedulingLink: parsed.schedulingLink ?? parsed.link,
    useCalendarAvailability: toBooleanOrUndefined(parsed.useCalendarAvailability ?? parsed.calendar),
    replyOnApplicationThread: toBooleanOrUndefined(
      parsed.replyOnApplicationThread ?? parsed.replyOnThread,
    ),
    windowStartISO: parsed.windowStartISO,
    windowEndISO: parsed.windowEndISO,
    durationMinutes: toNumberOrUndefined(parsed.durationMinutes ?? parsed.duration),
    slotIntervalMinutes: toNumberOrUndefined(parsed.slotIntervalMinutes ?? parsed.slotInterval),
    maxSuggestions: toNumberOrUndefined(parsed.maxSuggestions),
    sendMode: parsed.sendMode,
    timezone: parsed.timezone,
  };

  return buildForcedArgsInstruction({
    toolName: 'send_interview_proposal',
    commandDescription: 'an explicit send_interview_proposal command',
    args: proposalArgs,
  });
}

function buildAnalyzeCandidateReplyForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const analyzeArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    timezone: parsed.timezone,
    threadId: parsed.threadId,
    query: parsed.query,
    lookbackDays: toNumberOrUndefined(parsed.lookbackDays),
    maxResults: toNumberOrUndefined(parsed.maxResults),
  };

  return buildForcedArgsInstruction({
    toolName: 'analyze_candidate_scheduling_reply',
    commandDescription: 'an explicit analyze_candidate_scheduling_reply command',
    args: analyzeArgs,
  });
}

function buildScheduleCalForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const scheduleCalArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    eventTypeId: toNumberOrUndefined(parsed.eventTypeId),
    eventTypeSlug: parsed.eventTypeSlug,
    username: parsed.username,
    teamSlug: parsed.teamSlug,
    organizationSlug: parsed.organizationSlug,
    selectedStartISO: parsed.selectedStartISO,
    windowStartISO: parsed.windowStartISO,
    windowEndISO: parsed.windowEndISO,
    durationMinutes: toNumberOrUndefined(parsed.durationMinutes ?? parsed.duration),
    maxSuggestions: toNumberOrUndefined(parsed.maxSuggestions),
    timezone: parsed.timezone,
  };

  return buildForcedArgsInstruction({
    toolName: 'schedule_with_cal',
    commandDescription: 'an explicit schedule_with_cal command',
    args: scheduleCalArgs,
  });
}

function buildFinalScheduleFlowForcedArgsInstruction(rawText: string): string | undefined {
  const parsed = parseCommandArgs(rawText);
  const finalScheduleArgs = {
    candidateId: resolveCandidateId(parsed),
    jobId: resolveJobId(parsed),
    organizationId: resolveOrganizationId(parsed),
    actorUserId: parsed.actorUserId,
    action: parsed.action,
    sendMode: parsed.sendMode,
    timezone: parsed.timezone,
    durationMinutes: toNumberOrUndefined(parsed.durationMinutes ?? parsed.duration),
    preferredWeekdays: toStringListOrUndefined(parsed.preferredWeekdays ?? parsed.days),
    targetDayCount: toNumberOrUndefined(parsed.targetDayCount ?? parsed.dayCount),
    slotsPerDay: toNumberOrUndefined(parsed.slotsPerDay),
    maxSlotsToEmail: toNumberOrUndefined(parsed.maxSlotsToEmail ?? parsed.maxSuggestions),
    lookbackDays: toNumberOrUndefined(parsed.lookbackDays),
    maxResults: toNumberOrUndefined(parsed.maxResults),
    threadId: parsed.threadId,
    query: parsed.query,
    eventTypeSlug: parsed.eventTypeSlug,
    username: parsed.username,
    teamSlug: parsed.teamSlug,
    organizationSlug: parsed.organizationSlug,
    windowStartISO: parsed.windowStartISO,
    windowEndISO: parsed.windowEndISO,
    customMessage: parsed.customMessage,
  };

  return buildForcedArgsInstruction({
    toolName: 'run_final_schedule_flow',
    commandDescription: 'an explicit final scheduling command',
    args: finalScheduleArgs,
  });
}

function getForcedToolDecision(messages: Array<UIMessage>): ForcedToolDecision {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== 'user') {
    return {};
  }

  const text = uiMessageToText(latestMessage);
  const trimmedText = text.trim();

  const parseForcedArgs = (instruction: string | undefined): Record<string, unknown> | undefined => {
    if (!instruction) {
      return undefined;
    }

    const jsonMatch = instruction.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }

    return undefined;
  };

  if (/^\/schedule-cal\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildScheduleCalForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'schedule_with_cal',
      },
      forcedArgsInstruction,
      forcedToolName: 'schedule_with_cal',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/^\/propose\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildSendInterviewProposalForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'send_interview_proposal',
      },
      forcedArgsInstruction,
      forcedToolName: 'send_interview_proposal',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/^\/analyze-reply\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildAnalyzeCandidateReplyForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'analyze_candidate_scheduling_reply',
      },
      forcedArgsInstruction,
      forcedToolName: 'analyze_candidate_scheduling_reply',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/^\/(analyze-consensus|score-consensus)\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildMultiAgentCandidateScoreForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'run_multi_agent_candidate_score',
      },
      forcedArgsInstruction,
      forcedToolName: 'run_multi_agent_candidate_score',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/^\/submit-offer\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildSubmitOfferForClearanceForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'submit_offer_for_clearance',
      },
      forcedArgsInstruction,
      forcedToolName: 'submit_offer_for_clearance',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/^\/poll-offer\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildPollOfferClearanceForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'poll_offer_clearance',
      },
      forcedArgsInstruction,
      forcedToolName: 'poll_offer_clearance',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/^\/schedule\b/i.test(trimmedText)) {
    const forcedArgsInstruction = buildFinalScheduleFlowForcedArgsInstruction(trimmedText);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'run_final_schedule_flow',
      },
      forcedArgsInstruction,
      forcedToolName: 'run_final_schedule_flow',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\brun_connection_diagnostics\b/i.test(text) || /\brun\s+connection\s+diagnostics\b/i.test(text)) {
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'run_connection_diagnostics',
      },
    };
  }

  if (/\brun_intake_e2e\b/i.test(text) || /true\s+end[-\s]?to[-\s]?end\s+intake\s+run/i.test(text)) {
    const forcedArgsInstruction = buildIntakeForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'run_intake_e2e',
      },
      forcedArgsInstruction,
      forcedToolName: 'run_intake_e2e',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bschedule_interview_slots\b/i.test(text) || /\bschedule\s+interview\s+slots\b/i.test(text)) {
    const forcedArgsInstruction = buildScheduleForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'schedule_interview_slots',
      },
      forcedArgsInstruction,
      forcedToolName: 'schedule_interview_slots',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bparse_candidate_availability\b/i.test(text) || /\bparse\s+candidate\s+availability\b/i.test(text)) {
    const forcedArgsInstruction = buildParseAvailabilityForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'parse_candidate_availability',
      },
      forcedArgsInstruction,
      forcedToolName: 'parse_candidate_availability',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (
    /\banalyze_candidate_scheduling_reply\b/i.test(text) ||
    /\banalyze\s+candidate\s+scheduling\s+reply\b/i.test(text)
  ) {
    const forcedArgsInstruction = buildAnalyzeCandidateReplyForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'analyze_candidate_scheduling_reply',
      },
      forcedArgsInstruction,
      forcedToolName: 'analyze_candidate_scheduling_reply',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bsend_interview_proposal\b/i.test(text) || /\bsend\s+interview\s+proposal\b/i.test(text)) {
    const forcedArgsInstruction = buildSendInterviewProposalForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'send_interview_proposal',
      },
      forcedArgsInstruction,
      forcedToolName: 'send_interview_proposal',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bschedule_with_cal\b/i.test(text) || /\bschedule\s+with\s+cal\b/i.test(text)) {
    const forcedArgsInstruction = buildScheduleCalForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'schedule_with_cal',
      },
      forcedArgsInstruction,
      forcedToolName: 'schedule_with_cal',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\brun_final_schedule_flow\b/i.test(text) || /\bfinal\s+scheduling\s+flow\b/i.test(text)) {
    const forcedArgsInstruction = buildFinalScheduleFlowForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'run_final_schedule_flow',
      },
      forcedArgsInstruction,
      forcedToolName: 'run_final_schedule_flow',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bsend_interview_confirmation\b/i.test(text) || /\bsend\s+interview\s+confirmation\b/i.test(text)) {
    const forcedArgsInstruction = buildSendInterviewConfirmationForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'send_interview_confirmation',
      },
      forcedArgsInstruction,
      forcedToolName: 'send_interview_confirmation',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bdraft_offer_letter\b/i.test(text) || /\bdraft\s+offer\s+letter\b/i.test(text)) {
    const forcedArgsInstruction = buildDraftOfferLetterForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'draft_offer_letter',
      },
      forcedArgsInstruction,
      forcedToolName: 'draft_offer_letter',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (
    /\bsubmit_offer_for_clearance\b/i.test(text) ||
    /\bsubmit\s+offer\s+for\s+clearance\b/i.test(text)
  ) {
    const forcedArgsInstruction = buildSubmitOfferForClearanceForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'submit_offer_for_clearance',
      },
      forcedArgsInstruction,
      forcedToolName: 'submit_offer_for_clearance',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\bpoll_offer_clearance\b/i.test(text) || /\bpoll\s+offer\s+clearance\b/i.test(text)) {
    const forcedArgsInstruction = buildPollOfferClearanceForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'poll_offer_clearance',
      },
      forcedArgsInstruction,
      forcedToolName: 'poll_offer_clearance',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  if (/\brun_multi_agent_candidate_score\b/i.test(text)) {
    const forcedArgsInstruction = buildMultiAgentCandidateScoreForcedArgsInstruction(text);
    return {
      toolChoice: {
        type: 'tool',
        toolName: 'run_multi_agent_candidate_score',
      },
      forcedArgsInstruction,
      forcedToolName: 'run_multi_agent_candidate_score',
      forcedToolArgs: parseForcedArgs(forcedArgsInstruction),
    };
  }

  const match = text.match(/authorize_connections_step:([a-z_]+)/i);
  const step = match?.[1]?.toLowerCase();

  if (!step) {
    return {};
  }

  const toolNameByStep: Record<string, string> = {
    google: 'verify_google_connection',
    gmail_read: 'verify_gmail_read_connection',
    gmail_send: 'verify_gmail_send_connection',
    calendar: 'verify_calendar_connection',
    cal: 'verify_cal_connection',
    slack: 'verify_slack_connection',
  };

  const toolName = toolNameByStep[step];
  if (!toolName) {
    return {};
  }

  return {
    toolChoice: {
      type: 'tool',
      toolName,
    },
  };
}

function mergeToolArgs(
  rawInput: unknown,
  forcedArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const inputRecord = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? (rawInput as Record<string, unknown>)
    : {};

  if (forcedArgs) {
    // For slash-command forced tool calls, ignore model-supplied extras and
    // execute with exactly the parsed command arguments.
    return { ...forcedArgs };
  }

  return inputRecord;
}

function applyForcedArgsToTools(
  tools: Record<string, any>,
  decision: ForcedToolDecision,
): Record<string, any> {
  if (!decision.forcedToolName || !decision.forcedToolArgs) {
    return tools;
  }

  const targetTool = tools[decision.forcedToolName];
  if (!targetTool || typeof targetTool.execute !== 'function') {
    return tools;
  }

  return {
    ...tools,
    [decision.forcedToolName]: {
      ...targetTool,
      execute: async (input: unknown, context: unknown) =>
        targetTool.execute(mergeToolArgs(input, decision.forcedToolArgs), context),
    },
  };
}

/**
 * This handler initializes and calls an tool calling agent.
 */
export async function POST(req: NextRequest) {
  const { id, messages }: { id: string; messages: Array<UIMessage> } = await req.json();

  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  setAIContext({ threadID: id });

  const tools = {
    ...(serpApiTool ? { serpApiTool } : {}),
    getUserInfoTool,
    gmailSearchTool,
    gmailDraftTool,
    getCalendarEventsTool,
    getTasksTool,
    createTasksTool,
    shopOnlineTool,
    getContextDocumentsTool,
    listRepositories,
    listGitHubEvents,
    listSlackChannels,
    run_connection_diagnostics: runConnectionDiagnosticsTool,
    verify_google_connection: verifyGoogleConnectionTool,
    verify_gmail_read_connection: verifyGmailReadConnectionTool,
    verify_gmail_send_connection: verifyGmailSendConnectionTool,
    verify_calendar_connection: verifyCalendarConnectionTool,
    verify_cal_connection: verifyCalConnectionTool,
    verify_slack_connection: verifySlackConnectionTool,
    run_intake_e2e: runIntakeE2ETool,
    run_intercept: runInterceptTool,
    run_triage: runTriageTool,
    generate_intel_card: generateIntelCardTool,
    run_multi_agent_candidate_score: runMultiAgentCandidateScoreTool,
    parse_candidate_availability: parseCandidateAvailabilityTool,
    send_interview_proposal: sendInterviewProposalTool,
    analyze_candidate_scheduling_reply: analyzeCandidateSchedulingReplyTool,
    schedule_interview_slots: scheduleInterviewSlotsTool,
    schedule_with_cal: scheduleInterviewWithCalTool,
    run_final_schedule_flow: runFinalScheduleFlowTool,
    summarize_cal_booking_transcript: summarizeCalBookingTranscriptTool,
    summarize_drive_transcript_pdf: summarizeDriveTranscriptPdfTool,
    send_interview_confirmation: sendInterviewConfirmationTool,
    draft_offer_letter: draftOfferLetterTool,
    submit_offer_for_clearance: submitOfferForClearanceTool,
    poll_offer_clearance: pollOfferClearanceTool,
  };

  const modelMessages = await convertToModelMessages(messages);
  const forcedToolDecision = getForcedToolDecision(messages);
  const effectiveTools = applyForcedArgsToTools(tools as Record<string, any>, forcedToolDecision);

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: withInterruptions(
      async ({ writer }) => {
        const result = streamText({
          model: nim.chatModel(nimChatModelId),
          system: `${AGENT_SYSTEM_TEMPLATE}\n${DIAGNOSTICS_INSTRUCTIONS}\n${TRIAGE_INTEL_INSTRUCTIONS}${forcedToolDecision.forcedArgsInstruction ?? ''}`,
          messages: modelMessages,
          temperature: 0.6,
          topP: 0.9,
          maxOutputTokens: 4096,
          tools: effectiveTools as any,
          toolChoice: forcedToolDecision.toolChoice,
          onFinish: (output) => {
            if (output.finishReason === 'tool-calls') {
              const lastMessage = output.content[output.content.length - 1];
              if (lastMessage?.type === 'tool-error') {
                const { toolName, toolCallId, error, input } = lastMessage;
                const serializableError = {
                  message: extractErrorMessage(error),
                  cause: error,
                  toolCallId: toolCallId,
                  toolName: toolName,
                  toolArgs: input,
                };

                throw serializableError;
              }
            }
          },
        });

        writer.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          }),
        );
      },
      {
        messages: messages,
        tools: effectiveTools as any,
      },
    ),
    onError: errorSerializer((err) => {
      console.error(err);
      return `An error occurred! ${extractErrorMessage(err)}`;
    }),
  });

  return createUIMessageStreamResponse({ stream });
}
