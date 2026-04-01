import { Auth0AI, getAccessTokenFromTokenVault } from '@auth0/ai-vercel';
import { AccessDeniedInterrupt, TokenVaultError } from '@auth0/ai/interrupts';
import { google } from 'googleapis';

import { getRefreshToken, getUser } from './auth0';

const parseScopes = (raw: string | undefined, fallback: string[]) => {
  if (!raw) {
    return fallback;
  }

  const values = raw
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  return values.length > 0 ? values : fallback;
};

const uniqueScopes = (scopes: string[]) => Array.from(new Set(scopes));

export const GOOGLE_TOKEN_VAULT_CONNECTION = process.env.AUTH0_GOOGLE_CONNECTION || 'google-oauth2';
export const SLACK_TOKEN_VAULT_CONNECTION = process.env.AUTH0_SLACK_CONNECTION || 'sign-in-with-slack';

export const GMAIL_READ_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
];
export const GMAIL_WRITE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.compose',
];
export const CALENDAR_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events',
];
export const GOOGLE_UNIFIED_SCOPES = uniqueScopes([...GMAIL_READ_SCOPES, ...GMAIL_WRITE_SCOPES, ...CALENDAR_SCOPES]);
export const SLACK_SCOPES = parseScopes(process.env.AUTH0_SLACK_SCOPES, ['channels:read']);
const ENFORCE_GOOGLE_EMAIL_MATCH = (process.env.AUTH0_ENFORCE_GOOGLE_EMAIL_MATCH || 'true').toLowerCase() !== 'false';

const normalizeEmail = (value: string | undefined | null) => value?.trim().toLowerCase() || null;

async function getGoogleAccountEmail(accessToken: string) {
  const oauth2 = google.oauth2('v2');
  const auth = new google.auth.OAuth2();

  auth.setCredentials({ access_token: accessToken });

  const profile = await oauth2.userinfo.get({ auth });
  return normalizeEmail(profile.data.email);
}

// Get the access token for a connection via Auth0
export const getAccessToken = async () => getAccessTokenFromTokenVault();

export const getGoogleAccessToken = async () => {
  const accessToken = await getAccessTokenFromTokenVault();

  if (!ENFORCE_GOOGLE_EMAIL_MATCH) {
    return accessToken;
  }

  const user = await getUser();
  const auth0Email = normalizeEmail(user?.email);

  if (!auth0Email) {
    return accessToken;
  }

  let googleEmail: string | null = null;

  try {
    googleEmail = await getGoogleAccountEmail(accessToken);
  } catch (error) {
    throw new TokenVaultError('Unable to verify the connected Google account. Please reconnect and try again.');
  }

  // Some Google tokens may not include an email claim even for the correct account.
  // Only enforce mismatch when we can positively identify the Google account email.
  if (!googleEmail) {
    return accessToken;
  }

  if (googleEmail !== auth0Email) {
    throw new TokenVaultError(
      `Connected Google account (${googleEmail || 'unknown'}) does not match your signed-in account (${auth0Email}). Reconnect Google with the same email.`,
    );
  }

  return accessToken;
};

const auth0AI = new Auth0AI();

export const withGoogle = auth0AI.withTokenVault({
  connection: GOOGLE_TOKEN_VAULT_CONNECTION,
  scopes: GOOGLE_UNIFIED_SCOPES,
  refreshToken: getRefreshToken,
});

// Connection for Google services
export const withGmailRead = auth0AI.withTokenVault({
  connection: GOOGLE_TOKEN_VAULT_CONNECTION,
  scopes: GOOGLE_UNIFIED_SCOPES,
  refreshToken: getRefreshToken,
});
export const withGmailWrite = auth0AI.withTokenVault({
  connection: GOOGLE_TOKEN_VAULT_CONNECTION,
  scopes: GOOGLE_UNIFIED_SCOPES,
  refreshToken: getRefreshToken,
});
export const withCalendar = auth0AI.withTokenVault({
  connection: GOOGLE_TOKEN_VAULT_CONNECTION,
  scopes: GOOGLE_UNIFIED_SCOPES,
  refreshToken: getRefreshToken,
});

export const withGitHubConnection = auth0AI.withTokenVault({
  connection: 'github',
  // scopes are not supported for GitHub yet. Set required scopes when creating the accompanying GitHub app
  scopes: [],
  refreshToken: getRefreshToken,
  credentialsContext: 'tool-call',
});

export const withSlack = auth0AI.withTokenVault({
  connection: SLACK_TOKEN_VAULT_CONNECTION,
  scopes: SLACK_SCOPES,
  refreshToken: getRefreshToken,
});
export const withTasks = auth0AI.withTokenVault({
  connection: GOOGLE_TOKEN_VAULT_CONNECTION,
  scopes: ['https://www.googleapis.com/auth/tasks'],
  refreshToken: getRefreshToken,
});

// CIBA flow for user confirmation
export const withAsyncAuthorization = auth0AI.withAsyncAuthorization({
  userID: async () => {
    const user = await getUser();
    return user?.sub as string;
  },
  bindingMessage: async ({ product, qty }) => `Do you want to buy ${qty} ${product}`,
  scopes: ['openid', 'product:buy'],
  audience: process.env['SHOP_API_AUDIENCE']!,

  /**
   * Controls how long the authorization request is valid.
   */
  // requestedExpiry: 301,

  /**
   * The behavior when the authorization request is made.
   *
   * - `block`: The tool execution is blocked until the user completes the authorization.
   * - `interrupt`: The tool execution is interrupted until the user completes the authorization.
   * - a callback: Same as "block" but give access to the auth request and executing logic.
   *
   * Defaults to `interrupt`.
   *
   * When this flag is set to `block`, the execution of the tool awaits
   * until the user approves or rejects the request.
   * Given the asynchronous nature of the CIBA flow, this mode
   * is only useful during development.
   *
   * In practice, the process that is awaiting the user confirmation
   * could crash or timeout before the user approves the request.
   */
  onAuthorizationRequest: async (authReq, creds) => {
    console.log(`An authorization request was sent to your mobile device.`);
    await creds;
    console.log(`Thanks for approving the order.`);
  },

  onUnauthorized: async (e: Error) => {
    if (e instanceof AccessDeniedInterrupt) {
      return 'The user has denied the request';
    }
    return e.message;
  },
});
