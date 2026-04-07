import { TokenVaultError } from '@auth0/ai/interrupts';
import { ErrorCode, WebClient } from '@slack/web-api';
import { tool } from 'ai';
import { endOfDay, formatISO, startOfDay } from 'date-fns';
import { GaxiosError } from 'gaxios';
import { google } from 'googleapis';
import { z } from 'zod';

import {
  CAL_BOOKINGS_API_VERSION,
  CAL_COM_API_BASE_URL,
  CAL_COM_SCOPES,
  CAL_COM_TOKEN_VAULT_CONNECTION,
  CALENDAR_SCOPES,
  GMAIL_READ_SCOPES,
  GMAIL_WRITE_SCOPES,
  GOOGLE_UNIFIED_SCOPES,
  GOOGLE_TOKEN_VAULT_CONNECTION,
  SLACK_SCOPES,
  SLACK_TOKEN_VAULT_CONNECTION,
  getGoogleAccessToken,
  getAccessToken,
  getSlackAccessToken,
  withCal,
  withGoogle,
  withCalendar,
  withGmailRead,
  withGmailWrite,
  withSlack,
} from '@/lib/auth0-ai';
import { auth0 } from '@/lib/auth0';

type DiagnosticStatus = 'healthy' | 'unhealthy';

type ConnectedAccountSnapshot = {
  id: string;
  connection: string;
  scopes: string[];
  access_type?: string;
  expires_at?: string;
};

const CONNECTED_ACCOUNTS_AUDIENCE = `https://${process.env.AUTH0_DOMAIN}/me/`;
const CONNECTED_ACCOUNTS_ACCOUNTS_URL = `https://${process.env.AUTH0_DOMAIN}/me/v1/connected-accounts/accounts`;

async function loadConnectedAccountsSnapshot(): Promise<ConnectedAccountSnapshot[]> {
  const { token } = await auth0.getAccessToken({
    audience: CONNECTED_ACCOUNTS_AUDIENCE,
    scope: 'read:me:connected_accounts',
  });

  if (!token) {
    throw new Error('Missing My Account API token for connected accounts diagnostics.');
  }

  const response = await fetch(CONNECTED_ACCOUNTS_ACCOUNTS_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Connected Accounts API failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { accounts?: ConnectedAccountSnapshot[] };
  return Array.isArray(payload.accounts) ? payload.accounts : [];
}

function normalizeRequiredScopes(scopes: string[]) {
  return scopes.filter((scope) => scope !== 'openid');
}

function hasRefreshCapableAccess(accounts: ConnectedAccountSnapshot[]): boolean {
  return accounts.some((account) => {
    const accessType = (account.access_type ?? '').toLowerCase();
    return accessType.includes('offline') || accessType.includes('refresh');
  });
}

function buildScopeCheck(params: {
  check: string;
  provider: string;
  connection: string;
  requiredScopes: string[];
  accounts: ConnectedAccountSnapshot[];
}) {
  const connectionAccounts = params.accounts.filter((account) => account.connection === params.connection);

  if (connectionAccounts.length === 0) {
    return {
      check: params.check,
      provider: params.provider,
      connection: params.connection,
      status: 'unhealthy' as DiagnosticStatus,
      message: `No connected account found for ${params.connection}.`,
      details: {
        requiredScopes: params.requiredScopes,
        availableConnections: Array.from(new Set(params.accounts.map((account) => account.connection))),
      },
    };
  }

  const grantedScopeSet = new Set(connectionAccounts.flatMap((account) => account.scopes ?? []));
  const missingScopes = params.requiredScopes.filter((scope) => !grantedScopeSet.has(scope));

  const requiresOfflineAccess = !(
    process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_ID &&
    process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET &&
    process.env.AUTH0_TOKEN_VAULT_M2M_AUDIENCE
  );
  const hasOfflineAccessType = hasRefreshCapableAccess(connectionAccounts);

  if (requiresOfflineAccess && !hasOfflineAccessType) {
    return {
      check: params.check,
      provider: params.provider,
      connection: params.connection,
      status: 'unhealthy' as DiagnosticStatus,
      message:
        'Connected account is missing refresh-capable offline access. Reconnect this provider and approve consent for long-lived access.',
      details: {
        requiredScopes: params.requiredScopes,
        grantedScopes: Array.from(grantedScopeSet),
        connectedAccounts: connectionAccounts.map((account) => ({
          id: account.id,
          accessType: account.access_type ?? null,
          expiresAt: account.expires_at ?? null,
        })),
      },
    };
  }

  if (missingScopes.length > 0) {
    return {
      check: params.check,
      provider: params.provider,
      connection: params.connection,
      status: 'unhealthy' as DiagnosticStatus,
      message: `Connected account is missing required scopes: ${missingScopes.join(', ')}`,
      details: {
        requiredScopes: params.requiredScopes,
        missingScopes,
        grantedScopes: Array.from(grantedScopeSet),
      },
    };
  }

  return {
    check: params.check,
    provider: params.provider,
    connection: params.connection,
    status: 'healthy' as DiagnosticStatus,
    message: 'Connected account and required scopes are present.',
    details: {
      requiredScopes: params.requiredScopes,
      grantedScopes: Array.from(grantedScopeSet),
      connectedAccounts: connectionAccounts.map((account) => ({
        id: account.id,
        accessType: account.access_type ?? null,
        expiresAt: account.expires_at ?? null,
      })),
    },
  };
}

function resolveAuthorizeStep(connection: string): string | null {
  switch (connection) {
    case GOOGLE_TOKEN_VAULT_CONNECTION:
      return 'authorize_connections_step:google';
    case CAL_COM_TOKEN_VAULT_CONNECTION:
      return 'authorize_connections_step:cal';
    case SLACK_TOKEN_VAULT_CONNECTION:
      return 'authorize_connections_step:slack';
    default:
      return null;
  }
}

function makeAuthorizationInterruptMessage(params: {
  check: string;
  provider: string;
  connection: string;
  scopes: string[];
  reason?: string;
}) {
  const authorizeStep = resolveAuthorizeStep(params.connection);

  return [
    'Authorization required to run connection diagnostics.',
    `Check: ${params.check}`,
    `Provider: ${params.provider}`,
    `Connection: ${params.connection}`,
    params.reason ? `Reason: ${params.reason}` : null,
    `Required scopes: ${params.scopes.join(', ')}`,
    authorizeStep
      ? `Next step: run ${authorizeStep}, complete authorization, then rerun run_connection_diagnostics.`
      : 'Use Authorize to grant access and rerun run_connection_diagnostics.',
  ].join(' ');
}

function isGoogleAuthorizationError(error: unknown): boolean {
  if (!(error instanceof GaxiosError)) {
    return false;
  }

  if (error.status === 401 || error.status === 403) {
    return true;
  }

  const message = `${error.message ?? ''}`.toLowerCase();
  return message.includes('insufficient authentication scopes') || message.includes('invalid credentials');
}

function throwAuthorizationInterrupt(params: {
  check: string;
  provider: string;
  connection: string;
  scopes: string[];
  reason?: string;
}) {
  throw new TokenVaultError(makeAuthorizationInterruptMessage(params));
}

async function assertConnectedAccountScope(params: {
  check: string;
  provider: string;
  connection: string;
  requiredScopes: string[];
}) {
  try {
    const accounts = await loadConnectedAccountsSnapshot();
    const snapshotCheck = buildScopeCheck({
      check: params.check,
      provider: params.provider,
      connection: params.connection,
      requiredScopes: params.requiredScopes,
      accounts,
    });

    if (snapshotCheck.status === 'unhealthy') {
      throwAuthorizationInterrupt({
        check: params.check,
        provider: params.provider,
        connection: params.connection,
        scopes: params.requiredScopes,
        reason: snapshotCheck.message,
      });
    }
  } catch (error) {
    if (error instanceof TokenVaultError) {
      throw error;
    }

    // Do not block live connection checks if My Account diagnostics metadata is
    // temporarily unavailable; runtime API checks below will still verify health.
  }
}

function isGoogleIdentityMismatchError(error: unknown): boolean {
  return (
    error instanceof TokenVaultError &&
    typeof error.message === 'string' &&
    error.message.includes('does not match your signed-in account')
  );
}

function isTokenVaultAuthorizationRequiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /authorization required to access the token vault/i.test(error.message);
}

function isMissingFederatedRefreshTokenError(error: unknown): boolean {
  return (
    error instanceof TokenVaultError &&
    typeof error.message === 'string' &&
    /missing refresh token|refresh token not found|refresh token flow.*federated connection.*failed|offline access|cannot read properties of undefined \(reading ['\"]access_token['\"]\)|invalid_request.*access_token|not supported jwt type in subject token/i.test(
      error.message,
    )
  );
}

function failedDiagnostic(params: { check: string; provider: string; connection: string; message: string; code: string }) {
  return {
    check: params.check,
    provider: params.provider,
    connection: params.connection,
    status: 'unhealthy' as DiagnosticStatus,
    message: params.message,
    error: {
      code: params.code,
    },
  };
}

export const verifyGoogleConnectionTool = withGoogle(
  tool({
    description:
      'Verify a unified Google connection for Gmail read, Gmail send/compose, and Calendar access in a single authorization flow.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await assertConnectedAccountScope({
          check: 'verify_google_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          requiredScopes: normalizeRequiredScopes(GOOGLE_UNIFIED_SCOPES),
        });

        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const gmail = google.gmail('v1');
        const calendar = google.calendar('v3');

        const [profileResponse, draftsResponse, calendarResponse] = await Promise.all([
          gmail.users.getProfile({ auth, userId: 'me' }),
          gmail.users.drafts.list({ auth, userId: 'me', maxResults: 1 }),
          calendar.events.list({
            auth,
            calendarId: 'primary',
            timeMin: formatISO(startOfDay(new Date())),
            timeMax: formatISO(endOfDay(new Date())),
            singleEvents: true,
            maxResults: 1,
            orderBy: 'startTime',
          }),
        ]);

        return {
          check: 'verify_google_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          status: 'healthy' as DiagnosticStatus,
          message: 'Google connection is healthy for Gmail and Calendar.',
          details: {
            emailAddress: profileResponse.data.emailAddress ?? null,
            sampledDraftCount: draftsResponse.data.drafts?.length ?? 0,
            sampledEventsCount: calendarResponse.data.items?.length ?? 0,
            requiredScopes: GOOGLE_UNIFIED_SCOPES,
          },
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error)) {
          throw error;
        }

        if (error instanceof TokenVaultError || isGoogleAuthorizationError(error)) {
          throwAuthorizationInterrupt({
            check: 'verify_google_connection',
            provider: 'google',
            connection: GOOGLE_TOKEN_VAULT_CONNECTION,
            scopes: GOOGLE_UNIFIED_SCOPES,
          });
        }

        return failedDiagnostic({
          check: 'verify_google_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          message: error instanceof Error ? error.message : 'Unknown error while verifying Google access.',
          code: 'GOOGLE_CHECK_FAILED',
        });
      }
    },
  }),
);

export const verifyGmailReadConnectionTool = withGmailRead(
  tool({
    description:
      'Verify Gmail read connectivity using Token Vault and report provider-level health details for diagnostics.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await assertConnectedAccountScope({
          check: 'verify_gmail_read_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          requiredScopes: normalizeRequiredScopes(GMAIL_READ_SCOPES),
        });

        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const gmail = google.gmail('v1');
        const response = await gmail.users.getProfile({ auth, userId: 'me' });

        return {
          check: 'verify_gmail_read_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          status: 'healthy' as DiagnosticStatus,
          message: 'Gmail read connection is healthy.',
          details: {
            emailAddress: response.data.emailAddress ?? null,
            messagesTotal: response.data.messagesTotal ?? null,
            threadsTotal: response.data.threadsTotal ?? null,
          },
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error)) {
          throw error;
        }

        if (error instanceof TokenVaultError || isGoogleAuthorizationError(error)) {
          throwAuthorizationInterrupt({
            check: 'verify_gmail_read_connection',
            provider: 'google',
            connection: GOOGLE_TOKEN_VAULT_CONNECTION,
            scopes: GMAIL_READ_SCOPES,
          });
        }

        return failedDiagnostic({
          check: 'verify_gmail_read_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          message: error instanceof Error ? error.message : 'Unknown error while verifying Gmail read access.',
          code: 'GMAIL_READ_CHECK_FAILED',
        });
      }
    },
  }),
);

export const verifyGmailSendConnectionTool = withGmailWrite(
  tool({
    description:
      'Verify Gmail compose/send connectivity using Token Vault by checking draft listing permissions without modifying user data.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await assertConnectedAccountScope({
          check: 'verify_gmail_send_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          requiredScopes: normalizeRequiredScopes(GMAIL_WRITE_SCOPES),
        });

        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const gmail = google.gmail('v1');
        const response = await gmail.users.drafts.list({ auth, userId: 'me', maxResults: 1 });

        return {
          check: 'verify_gmail_send_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          status: 'healthy' as DiagnosticStatus,
          message: 'Gmail send/compose connection is healthy.',
          details: {
            sampledDraftCount: response.data.drafts?.length ?? 0,
            resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
          },
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error)) {
          throw error;
        }

        if (error instanceof TokenVaultError || isGoogleAuthorizationError(error)) {
          throwAuthorizationInterrupt({
            check: 'verify_gmail_send_connection',
            provider: 'google',
            connection: GOOGLE_TOKEN_VAULT_CONNECTION,
            scopes: GMAIL_WRITE_SCOPES,
          });
        }

        return failedDiagnostic({
          check: 'verify_gmail_send_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          message: error instanceof Error ? error.message : 'Unknown error while verifying Gmail send access.',
          code: 'GMAIL_SEND_CHECK_FAILED',
        });
      }
    },
  }),
);

export const verifyCalendarConnectionTool = withCalendar(
  tool({
    description: 'Verify Google Calendar connection by fetching events for the current day using Token Vault credentials.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await assertConnectedAccountScope({
          check: 'verify_calendar_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          requiredScopes: normalizeRequiredScopes(CALENDAR_SCOPES),
        });

        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const calendar = google.calendar('v3');
        const now = new Date();
        const response = await calendar.events.list({
          auth,
          calendarId: 'primary',
          timeMin: formatISO(startOfDay(now)),
          timeMax: formatISO(endOfDay(now)),
          singleEvents: true,
          maxResults: 1,
          orderBy: 'startTime',
        });

        return {
          check: 'verify_calendar_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          status: 'healthy' as DiagnosticStatus,
          message: 'Google Calendar connection is healthy.',
          details: {
            calendarId: response.data.summary ?? 'primary',
            sampledEventsCount: response.data.items?.length ?? 0,
          },
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error)) {
          throw error;
        }

        if (error instanceof TokenVaultError || isGoogleAuthorizationError(error)) {
          throwAuthorizationInterrupt({
            check: 'verify_calendar_connection',
            provider: 'google',
            connection: GOOGLE_TOKEN_VAULT_CONNECTION,
            scopes: CALENDAR_SCOPES,
          });
        }

        return failedDiagnostic({
          check: 'verify_calendar_connection',
          provider: 'google',
          connection: GOOGLE_TOKEN_VAULT_CONNECTION,
          message: error instanceof Error ? error.message : 'Unknown error while verifying Calendar access.',
          code: 'CALENDAR_CHECK_FAILED',
        });
      }
    },
  }),
);

export const verifyCalConnectionTool = withCal(
  tool({
    description: 'Verify Cal.com connection by fetching the authenticated founder profile from Cal API v2.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await assertConnectedAccountScope({
          check: 'verify_cal_connection',
          provider: 'cal',
          connection: CAL_COM_TOKEN_VAULT_CONNECTION,
          requiredScopes: CAL_COM_SCOPES,
        });

        const accessToken = await getAccessToken();
        const response = await fetch(`${CAL_COM_API_BASE_URL}/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'cal-api-version': CAL_BOOKINGS_API_VERSION,
          },
        });

        if (response.status === 401 || response.status === 403) {
          throwAuthorizationInterrupt({
            check: 'verify_cal_connection',
            provider: 'cal',
            connection: CAL_COM_TOKEN_VAULT_CONNECTION,
            scopes: CAL_COM_SCOPES,
          });
        }

        if (!response.ok) {
          const details = await response.text();
          return failedDiagnostic({
            check: 'verify_cal_connection',
            provider: 'cal',
            connection: CAL_COM_TOKEN_VAULT_CONNECTION,
            message: `Cal profile lookup failed (${response.status}): ${details}`,
            code: 'CAL_CHECK_FAILED',
          });
        }

        const payload = (await response.json()) as {
          data?: {
            id?: number;
            email?: string;
            username?: string;
            name?: string | null;
            timeZone?: string;
          };
        };

        return {
          check: 'verify_cal_connection',
          provider: 'cal',
          connection: CAL_COM_TOKEN_VAULT_CONNECTION,
          status: 'healthy' as DiagnosticStatus,
          message: 'Cal.com connection is healthy.',
          details: {
            id: payload.data?.id ?? null,
            email: payload.data?.email ?? null,
            username: payload.data?.username ?? null,
            name: payload.data?.name ?? null,
            timeZone: payload.data?.timeZone ?? null,
          },
        };
      } catch (error) {
        if (error instanceof TokenVaultError) {
          throwAuthorizationInterrupt({
            check: 'verify_cal_connection',
            provider: 'cal',
            connection: CAL_COM_TOKEN_VAULT_CONNECTION,
            scopes: CAL_COM_SCOPES,
          });
        }

        return failedDiagnostic({
          check: 'verify_cal_connection',
          provider: 'cal',
          connection: CAL_COM_TOKEN_VAULT_CONNECTION,
          message: error instanceof Error ? error.message : 'Unknown error while verifying Cal.com access.',
          code: 'CAL_CHECK_FAILED',
        });
      }
    },
  }),
);

export const verifySlackConnectionTool = withSlack(
  tool({
    description: 'Verify Slack connection by performing auth.test and a minimal channels read operation.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await assertConnectedAccountScope({
          check: 'verify_slack_connection',
          provider: 'slack',
          connection: SLACK_TOKEN_VAULT_CONNECTION,
          requiredScopes: SLACK_SCOPES,
        });

        const accessToken = await getSlackAccessToken({ allowTokenVaultFallback: true });
        const web = new WebClient(accessToken);

        const authResult = await web.auth.test();
        const channelsResult = await web.conversations.list({
          exclude_archived: true,
          types: SLACK_SCOPES.includes('groups:read') ? 'public_channel,private_channel' : 'public_channel',
          limit: 1,
        });

        return {
          check: 'verify_slack_connection',
          provider: 'slack',
          connection: SLACK_TOKEN_VAULT_CONNECTION,
          status: 'healthy' as DiagnosticStatus,
          message: 'Slack connection is healthy.',
          details: {
            team: authResult.team ?? null,
            user: authResult.user ?? null,
            sampledChannelCount: channelsResult.channels?.length ?? 0,
          },
        };
      } catch (error) {
        if (isMissingFederatedRefreshTokenError(error)) {
          throw error;
        }

        if (error instanceof TokenVaultError) {
          throwAuthorizationInterrupt({
            check: 'verify_slack_connection',
            provider: 'slack',
            connection: SLACK_TOKEN_VAULT_CONNECTION,
            scopes: SLACK_SCOPES,
          });
        }

        if (error && typeof error === 'object' && 'code' in error && error.code === ErrorCode.HTTPError) {
          throwAuthorizationInterrupt({
            check: 'verify_slack_connection',
            provider: 'slack',
            connection: SLACK_TOKEN_VAULT_CONNECTION,
            scopes: SLACK_SCOPES,
          });
        }

        if (isTokenVaultAuthorizationRequiredError(error)) {
          throwAuthorizationInterrupt({
            check: 'verify_slack_connection',
            provider: 'slack',
            connection: SLACK_TOKEN_VAULT_CONNECTION,
            scopes: SLACK_SCOPES,
          });
        }

        return failedDiagnostic({
          check: 'verify_slack_connection',
          provider: 'slack',
          connection: SLACK_TOKEN_VAULT_CONNECTION,
          message: error instanceof Error ? error.message : 'Unknown error while verifying Slack access.',
          code: 'SLACK_CHECK_FAILED',
        });
      }
    },
  }),
);

export const runConnectionDiagnosticsTool = tool({
  description:
    'Run deterministic connection diagnostics using Auth0 My Account connected-accounts metadata for Google and Slack.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const accounts = await loadConnectedAccountsSnapshot();

      const gmailRead = buildScopeCheck({
        check: 'verify_gmail_read_connection',
        provider: 'google',
        connection: GOOGLE_TOKEN_VAULT_CONNECTION,
        requiredScopes: normalizeRequiredScopes(GMAIL_READ_SCOPES),
        accounts,
      });

      const gmailWrite = buildScopeCheck({
        check: 'verify_gmail_send_connection',
        provider: 'google',
        connection: GOOGLE_TOKEN_VAULT_CONNECTION,
        requiredScopes: normalizeRequiredScopes(GMAIL_WRITE_SCOPES),
        accounts,
      });

      const calendar = buildScopeCheck({
        check: 'verify_calendar_connection',
        provider: 'google',
        connection: GOOGLE_TOKEN_VAULT_CONNECTION,
        requiredScopes: normalizeRequiredScopes(CALENDAR_SCOPES),
        accounts,
      });

      const cal = buildScopeCheck({
        check: 'verify_cal_connection',
        provider: 'cal',
        connection: CAL_COM_TOKEN_VAULT_CONNECTION,
        requiredScopes: CAL_COM_SCOPES,
        accounts,
      });

      const slack = buildScopeCheck({
        check: 'verify_slack_connection',
        provider: 'slack',
        connection: SLACK_TOKEN_VAULT_CONNECTION,
        requiredScopes: SLACK_SCOPES,
        accounts,
      });

      const checks = [gmailRead, gmailWrite, calendar, cal, slack];
      const overallStatus = checks.every((check) => check.status === 'healthy') ? 'healthy' : 'unhealthy';

      return {
        check: 'run_connection_diagnostics',
        status: overallStatus as DiagnosticStatus,
        message:
          overallStatus === 'healthy'
            ? 'All connected account checks passed.'
            : 'One or more connected account checks failed. Review missing scopes or missing connections.',
        checks,
      };
    } catch (error) {
      return {
        check: 'run_connection_diagnostics',
        status: 'unhealthy' as DiagnosticStatus,
        message: error instanceof Error ? error.message : 'Failed to run connected account diagnostics.',
        checks: [],
      };
    }
  },
});