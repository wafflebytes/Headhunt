import { ErrorCode, WebClient } from '@slack/web-api';
import { TokenVaultError } from '@auth0/ai/interrupts';
import {
  withSlack,
  getSlackAccessToken,
  SLACK_SCOPES,
  SLACK_TOKEN_VAULT_CONNECTION,
} from '@/lib/auth0-ai';
import { tool } from 'ai';
import { z } from 'zod';

export const listSlackChannels = withSlack(
  tool({
    description: 'List channels for the current user on Slack',
    inputSchema: z.object({
      tokenVaultLoginHint: z.string().optional(),
      actorUserId: z.string().optional(),
      allowTokenVaultFallback: z.boolean().optional(),
    }),
    execute: async ({ tokenVaultLoginHint, actorUserId, allowTokenVaultFallback }) => {
      const hasPrivateChannelScope = SLACK_SCOPES.includes('groups:read');

      // Get the access token from Auth0 AI
      const accessToken = await getSlackAccessToken({
        loginHint: tokenVaultLoginHint ?? actorUserId,
        allowTokenVaultFallback,
      });

      // Slack SDK
      try {
        const web = new WebClient(accessToken);

        const result = await web.conversations.list({
          exclude_archived: true,
          types: hasPrivateChannelScope ? 'public_channel,private_channel' : 'public_channel',
          limit: 10,
        });

        const channelNames = result.channels?.map((channel) => channel.name) || [];

        return {
          total_channels: channelNames.length,
          channels: channelNames,
        };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) {
          if (error.code === ErrorCode.HTTPError) {
            throw new TokenVaultError(
              `Authorization required to access the Token Vault: ${SLACK_TOKEN_VAULT_CONNECTION}. Required scopes: ${SLACK_SCOPES.join(', ')}`,
            );
          }
        }

        if (error instanceof Error && /authorization required to access the token vault/i.test(error.message)) {
          throw new TokenVaultError(
            `Authorization required to access the Token Vault: ${SLACK_TOKEN_VAULT_CONNECTION}. Required scopes: ${SLACK_SCOPES.join(', ')}`,
          );
        }

        throw error;
      }
    },
  }),
);
