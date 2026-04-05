import { Auth0AI, getAccessTokenFromTokenVault } from '@auth0/ai-vercel';
import { TokenVaultError } from '@auth0/ai/interrupts';
import { SUBJECT_TOKEN_TYPES } from '@auth0/ai';
import { google } from 'googleapis';

import { getRefreshToken, getSessionAccessToken, getUser } from './auth0';

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

type TokenVaultSubjectExchangeMode = 'refresh' | 'access';

const parseTokenExchangeMode = (
  raw: string | undefined,
  fallback: TokenVaultSubjectExchangeMode,
): TokenVaultSubjectExchangeMode => {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'refresh' || normalized === 'access') {
    return normalized;
  }

  return fallback;
};

const SUBJECT_TOKEN_TYPE_ACCESS_TOKEN = SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_ACCESS_TOKEN;

const buildSubjectExchangeConfig = (mode: TokenVaultSubjectExchangeMode) =>
  mode === 'access'
    ? {
        accessToken: getSessionAccessToken,
        subjectTokenType: SUBJECT_TOKEN_TYPE_ACCESS_TOKEN,
      }
    : {
        refreshToken: getRefreshToken,
      };

const parseAuthorizationParams = (
  raw: string | undefined,
  fallback: Record<string, string> = {},
) => {
  if (!raw) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed).filter(
        ([key, value]) => key.trim().length > 0 && typeof value === 'string' && value.trim().length > 0,
      );

      if (entries.length > 0) {
        return {
          ...fallback,
          ...Object.fromEntries(entries),
        };
      }
    }
  } catch {
    // Fallback to key=value parsing below.
  }

  const kvEntries = trimmed
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0 || separatorIndex >= pair.length - 1) {
        return null;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();

      if (!key || !value) {
        return null;
      }

      return [key, value] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);

  if (kvEntries.length === 0) {
    return fallback;
  }

  return {
    ...fallback,
    ...Object.fromEntries(kvEntries),
  };
};

export const GOOGLE_TOKEN_VAULT_CONNECTION = process.env.AUTH0_GOOGLE_CONNECTION || 'google-oauth2';
export const SLACK_TOKEN_VAULT_CONNECTION = process.env.AUTH0_SLACK_CONNECTION || 'sign-in-with-slack';
export const CAL_COM_TOKEN_VAULT_CONNECTION = process.env.AUTH0_CAL_CONNECTION || 'cal-connection';
export const SLACK_TOKEN_EXCHANGE_MODE = parseTokenExchangeMode(
  process.env.AUTH0_SLACK_TOKEN_EXCHANGE_MODE,
  'refresh',
);
export const CAL_COM_TOKEN_EXCHANGE_MODE = parseTokenExchangeMode(
  process.env.AUTH0_CAL_TOKEN_EXCHANGE_MODE,
  'refresh',
);

export const CAL_COM_API_BASE_URL = process.env.CAL_COM_API_BASE_URL || 'https://api.cal.com/v2';
export const CAL_SLOTS_API_VERSION = process.env.CAL_SLOTS_API_VERSION || '2024-09-04';
export const CAL_BOOKINGS_API_VERSION = process.env.CAL_BOOKINGS_API_VERSION || '2026-02-25';

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
export const DRIVE_READ_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.readonly',
];
export const GOOGLE_UNIFIED_SCOPES = uniqueScopes([...GMAIL_READ_SCOPES, ...GMAIL_WRITE_SCOPES, ...CALENDAR_SCOPES]);
export const SLACK_SCOPES = uniqueScopes(
  parseScopes(process.env.AUTH0_SLACK_SCOPES, ['channels:read', 'channels:history', 'chat:write']),
);
export const CAL_COM_SCOPES = uniqueScopes(parseScopes(process.env.AUTH0_CAL_SCOPES, [
  'PROFILE_READ',
  'SCHEDULE_READ',
  'SCHEDULE_WRITE',
  'BOOKING_READ',
  'BOOKING_WRITE',
  'EVENT_TYPE_READ',
  'EVENT_TYPE_WRITE',
]));
export const SLACK_AUTHORIZATION_PARAMS = parseAuthorizationParams(
  process.env.AUTH0_SLACK_AUTHORIZATION_PARAMS,
  { prompt: 'consent' },
);
export const CAL_COM_AUTHORIZATION_PARAMS = parseAuthorizationParams(
  process.env.AUTH0_CAL_AUTHORIZATION_PARAMS,
  { prompt: 'consent' },
);
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

export const withSlack = auth0AI.withTokenVault({
  connection: SLACK_TOKEN_VAULT_CONNECTION,
  scopes: SLACK_SCOPES,
  authorizationParams: SLACK_AUTHORIZATION_PARAMS,
  ...buildSubjectExchangeConfig(SLACK_TOKEN_EXCHANGE_MODE),
});
export const withCal = auth0AI.withTokenVault({
  connection: CAL_COM_TOKEN_VAULT_CONNECTION,
  scopes: CAL_COM_SCOPES,
  authorizationParams: CAL_COM_AUTHORIZATION_PARAMS,
  ...buildSubjectExchangeConfig(CAL_COM_TOKEN_EXCHANGE_MODE),
});

export const withDrive = auth0AI.withTokenVault({
  connection: GOOGLE_TOKEN_VAULT_CONNECTION,
  scopes: DRIVE_READ_SCOPES,
  refreshToken: getRefreshToken,
});
