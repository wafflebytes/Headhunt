import { NextRequest } from 'next/server';
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
  verifyCalendarConnectionTool,
  verifyGoogleConnectionTool,
  verifyGmailReadConnectionTool,
  verifyGmailSendConnectionTool,
  verifySlackConnectionTool,
} from '@/lib/tools/connection-diagnostics';

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
- authorize_connections_step:slack -> verify_slack_connection

When diagnostics show any Google check as unhealthy, recommend authorize_connections_step:google as the next step.
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

function getForcedToolChoice(messages: Array<UIMessage>) {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== 'user') {
    return undefined;
  }

  const text = uiMessageToText(latestMessage);

  if (/\brun_connection_diagnostics\b/i.test(text) || /\brun\s+connection\s+diagnostics\b/i.test(text)) {
    return {
      type: 'tool' as const,
      toolName: 'run_connection_diagnostics',
    };
  }

  const match = text.match(/authorize_connections_step:([a-z_]+)/i);
  const step = match?.[1]?.toLowerCase();

  if (!step) {
    return undefined;
  }

  const toolNameByStep: Record<string, string> = {
    google: 'verify_google_connection',
    gmail_read: 'verify_gmail_read_connection',
    gmail_send: 'verify_gmail_send_connection',
    calendar: 'verify_calendar_connection',
    slack: 'verify_slack_connection',
  };

  const toolName = toolNameByStep[step];
  if (!toolName) {
    return undefined;
  }

  return {
    type: 'tool' as const,
    toolName,
  };
}

/**
 * This handler initializes and calls an tool calling agent.
 */
export async function POST(req: NextRequest) {
  const { id, messages }: { id: string; messages: Array<UIMessage> } = await req.json();

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
    verify_slack_connection: verifySlackConnectionTool,
  };

  const modelMessages = await convertToModelMessages(messages);
  const forcedToolChoice = getForcedToolChoice(messages);

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: withInterruptions(
      async ({ writer }) => {
        const result = streamText({
          model: nim.chatModel(nimChatModelId),
          system: `${AGENT_SYSTEM_TEMPLATE}\n${DIAGNOSTICS_INSTRUCTIONS}`,
          messages: modelMessages,
          temperature: 0.6,
          topP: 0.9,
          maxOutputTokens: 4096,
          tools: tools as any,
          toolChoice: forcedToolChoice,
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
        tools: tools as any,
      },
    ),
    onError: errorSerializer((err) => {
      console.error(err);
      return `An error occurred! ${extractErrorMessage(err)}`;
    }),
  });

  return createUIMessageStreamResponse({ stream });
}
