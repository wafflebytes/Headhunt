import { ErrorCode, WebClient } from '@slack/web-api';
import { TokenVaultError } from '@auth0/ai/interrupts';
import { tool } from 'ai';
import { z } from 'zod';

import { getAccessToken, SLACK_SCOPES, SLACK_TOKEN_VAULT_CONNECTION, withSlack } from '@/lib/auth0-ai';

type SlackChannel = {
  id: string;
  name: string | null;
};

function normalizeChannelInput(value: string): string {
  return value.trim().replace(/^#/, '');
}

function isChannelId(value: string): boolean {
  return /^[CGD][A-Z0-9]+$/i.test(value.trim());
}

async function resolveChannel(web: WebClient, channelInput: string): Promise<SlackChannel> {
  const normalizedInput = normalizeChannelInput(channelInput);
  if (!normalizedInput) {
    throw new Error('A Slack channel is required.');
  }

  if (isChannelId(normalizedInput)) {
    return { id: normalizedInput, name: null };
  }

  const includePrivateChannels = SLACK_SCOPES.includes('groups:read');
  let cursor: string | undefined;

  while (true) {
    const result = await web.conversations.list({
      exclude_archived: true,
      types: includePrivateChannels ? 'public_channel,private_channel' : 'public_channel',
      limit: 200,
      cursor,
    });

    const match = result.channels?.find((channel) => channel.name === normalizedInput);
    if (match?.id) {
      return { id: match.id, name: match.name ?? normalizedInput };
    }

    cursor = result.response_metadata?.next_cursor?.trim() || undefined;
    if (!cursor) {
      break;
    }
  }

  throw new Error(`Slack channel not found: #${normalizedInput}`);
}

export const sendSlackMessageTool = withSlack(
  tool({
    description: 'Send a general message to a Slack channel by name or channel ID.',
    inputSchema: z.object({
      channel: z.string().min(1),
      text: z.string().min(1),
      threadTs: z.string().optional(),
    }),
    execute: async ({ channel, text, threadTs }) => {
      try {
        const accessToken = await getAccessToken();
        const web = new WebClient(accessToken);
        const resolvedChannel = await resolveChannel(web, channel);

        const response = await web.chat.postMessage({
          channel: resolvedChannel.id,
          text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });

        if (!response.ok) {
          throw new Error(response.error || 'Slack message could not be sent.');
        }

        let permalink: string | null = null;
        try {
          const permalinkResponse = await web.chat.getPermalink({
            channel: response.channel ?? resolvedChannel.id,
            message_ts: response.ts ?? '',
          });
          permalink = permalinkResponse.permalink ?? null;
        } catch {
          permalink = null;
        }

        const channelLabel = resolvedChannel.name ? `#${resolvedChannel.name}` : resolvedChannel.id;

        return {
          check: 'send_slack_message',
          provider: 'slack',
          connection: SLACK_TOKEN_VAULT_CONNECTION,
          status: 'success',
          mode: threadTs ? 'reply' : 'send',
          message: `Slack message sent to ${channelLabel}.`,
          channel: {
            id: response.channel ?? resolvedChannel.id,
            name: resolvedChannel.name,
          },
          post: {
            ts: response.ts ?? null,
            permalink,
            text,
            threadTs: threadTs ?? null,
          },
        };
      } catch (error) {
        if (error instanceof TokenVaultError) {
          throw error;
        }

        if (error && typeof error === 'object' && 'code' in error && error.code === ErrorCode.HTTPError) {
          throw new TokenVaultError(
            `Authorization required to access the Token Vault: ${SLACK_TOKEN_VAULT_CONNECTION}. Required scopes: ${SLACK_SCOPES.join(', ')}`,
          );
        }

        if (error instanceof Error && /authorization required to access the token vault/i.test(error.message)) {
          throw new TokenVaultError(
            `Authorization required to access the Token Vault: ${SLACK_TOKEN_VAULT_CONNECTION}. Required scopes: ${SLACK_SCOPES.join(', ')}`,
          );
        }

        return {
          check: 'send_slack_message',
          provider: 'slack',
          connection: SLACK_TOKEN_VAULT_CONNECTION,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while sending the Slack message.',
        };
      }
    },
  }),
);