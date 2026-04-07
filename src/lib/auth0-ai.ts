import { Auth0AI, getAccessTokenFromTokenVault } from '@auth0/ai-vercel';
import { TokenVaultError } from '@auth0/ai/interrupts';
import { SUBJECT_TOKEN_TYPES } from '@auth0/ai';
import { google } from 'googleapis';

import { getRefreshToken, getSessionAccessToken, getUser } from './auth0';
import { getAuth0SubjectRefreshToken } from './auth0-subject-refresh-token';

const FEDERATED_CONNECTION_GRANT_TYPE =
  'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token';
const REQUESTED_TOKEN_TYPE_FEDERATED_CONNECTION = 'http://auth0.com/oauth/token-type/federated-connection-access-token';
const SUBJECT_TOKEN_TYPE_REFRESH_TOKEN = 'urn:ietf:params:oauth:token-type:refresh_token';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

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
type GoogleAccessTokenSourceMode = 'token_vault' | 'token_exchange' | 'auto';
type SlackAccessTokenSourceMode = 'token_vault' | 'token_exchange' | 'auto';

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

const parseGoogleAccessTokenSourceMode = (raw: string | undefined): GoogleAccessTokenSourceMode => {
  const normalized = raw?.trim().toLowerCase();

  if (normalized === 'token_vault' || normalized === 'token_exchange' || normalized === 'auto') {
    return normalized;
  }

  // Backwards-compat: the previous implementation used Management API tokensets.
  // That endpoint is deprecated / not enabled in many tenants; treat it as token-exchange.
  if (normalized === 'management_api') {
    return 'token_exchange';
  }

  return 'auto';
};

const parseSlackAccessTokenSourceMode = (raw: string | undefined): SlackAccessTokenSourceMode => {
  const normalized = raw?.trim().toLowerCase();

  if (normalized === 'token_vault' || normalized === 'token_exchange' || normalized === 'auto') {
    return normalized;
  }

  return 'auto';
};

const SUBJECT_TOKEN_TYPE_ACCESS_TOKEN = SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_ACCESS_TOKEN;
const M2M_TOKEN_EXPIRY_SKEW_MS = 30_000;

type TokenVaultM2MTokenCache = {
  accessToken: string;
  expiresAtEpochMs: number;
};

let tokenVaultM2MTokenCache: TokenVaultM2MTokenCache | null = null;
let tokenVaultM2MTokenInflight: Promise<string | undefined> | null = null;

const buildSubjectExchangeConfig = (mode: TokenVaultSubjectExchangeMode) =>
  mode === 'access'
    ? {
        accessToken: getTokenVaultSubjectAccessToken,
        subjectTokenType: SUBJECT_TOKEN_TYPE_ACCESS_TOKEN,
        loginHint: resolveTokenVaultLoginHint,
      }
    : {
        refreshToken: getRefreshToken,
      };

const hasTokenVaultM2MConfig = () =>
  Boolean(
    asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_ID) &&
      asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET) &&
      asString(process.env.AUTH0_TOKEN_VAULT_M2M_AUDIENCE),
  );

const resolveTokenVaultLoginHint = (...toolContext: unknown[]) => {
  const input = toolContext[0];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const explicitLoginHint = asString(record.tokenVaultLoginHint) ?? asString(record.loginHint);
    if (explicitLoginHint) {
      return explicitLoginHint;
    }

    const actorUserId = asString(record.actorUserId) ?? asString(record.actorId);
    if (actorUserId) {
      return actorUserId;
    }
  }

  return asString(process.env.AUTH0_TOKEN_VAULT_LOGIN_HINT);
};

async function fetchTokenVaultM2MSubjectToken(): Promise<string | undefined> {
  const domain = asString(process.env.AUTH0_DOMAIN);
  const clientId = asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_ID);
  const clientSecret = asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET);
  const audience = asString(process.env.AUTH0_TOKEN_VAULT_M2M_AUDIENCE);

  if (!domain || !clientId || !clientSecret || !audience) {
    return undefined;
  }

  if (tokenVaultM2MTokenCache && tokenVaultM2MTokenCache.expiresAtEpochMs - M2M_TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return tokenVaultM2MTokenCache.accessToken;
  }

  if (tokenVaultM2MTokenInflight) {
    return tokenVaultM2MTokenInflight;
  }

  tokenVaultM2MTokenInflight = (async () => {
    const scope = asString(process.env.AUTH0_TOKEN_VAULT_M2M_SCOPE);
    const response = await fetch(`https://${domain}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience,
        ...(scope ? { scope } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new TokenVaultError(
        `Failed to obtain Auth0 M2M token for Token Vault exchange (status ${response.status}): ${body || 'unknown error'}`,
      );
    }

    const tokenResponse = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    const accessToken = asString(tokenResponse.access_token);
    if (!accessToken) {
      throw new TokenVaultError('Auth0 M2M token response did not include access_token.');
    }

    const expiresInSeconds =
      typeof tokenResponse.expires_in === 'number' && Number.isFinite(tokenResponse.expires_in)
        ? Math.max(60, Math.floor(tokenResponse.expires_in))
        : 300;

    tokenVaultM2MTokenCache = {
      accessToken,
      expiresAtEpochMs: Date.now() + expiresInSeconds * 1000,
    };

    return accessToken;
  })().finally(() => {
    tokenVaultM2MTokenInflight = null;
  });

  return tokenVaultM2MTokenInflight;
}

async function getTokenVaultSubjectAccessToken() {
  const sessionAccessToken = await getSessionAccessToken().catch(() => undefined);
  if (sessionAccessToken) {
    return sessionAccessToken;
  }

  const m2mAccessToken = await fetchTokenVaultM2MSubjectToken();
  if (m2mAccessToken) {
    return m2mAccessToken;
  }

  throw new TokenVaultError(
    'Unable to obtain Auth0 subject token for Token Vault exchange. Provide an authenticated session cookie or configure AUTH0_TOKEN_VAULT_M2M_CLIENT_ID, AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET, and AUTH0_TOKEN_VAULT_M2M_AUDIENCE.',
  );
}

function resolveAuth0Domain(): string | undefined {
  const raw = asString(process.env.AUTH0_DOMAIN);
  if (!raw) {
    return undefined;
  }

  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
}

function resolveTokenExchangeClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = asString(process.env.AUTH0_CLIENT_ID);
  const clientSecret = asString(process.env.AUTH0_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new TokenVaultError('Missing AUTH0_CLIENT_ID/AUTH0_CLIENT_SECRET required for token exchange.');
  }

  return { clientId, clientSecret };
}

async function exchangeSubjectTokenForConnectionAccessToken(params: {
  subjectToken: string;
  subjectTokenType: string;
  connection: string;
  loginHint?: string;
}) {
  const domain = resolveAuth0Domain();
  if (!domain) {
    throw new TokenVaultError('AUTH0_DOMAIN is required for federated token exchange.');
  }

  const { clientId, clientSecret } = resolveTokenExchangeClientCredentials();

  const body = new URLSearchParams({
    grant_type: FEDERATED_CONNECTION_GRANT_TYPE,
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: params.subjectToken,
    subject_token_type: params.subjectTokenType,
    requested_token_type: REQUESTED_TOKEN_TYPE_FEDERATED_CONNECTION,
    connection: params.connection,
  });

  const loginHint = asString(params.loginHint);
  if (loginHint) {
    body.set('login_hint', loginHint);
  }

  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const raw = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const accessToken = asString(parsed.access_token);

  if (!response.ok || !accessToken) {
    throw new TokenVaultError(
      `Federated token exchange failed (status ${response.status}): ${
        asString(parsed.error_description) ?? asString(parsed.error) ?? (raw || 'unknown error')
      }`,
    );
  }

  return accessToken;
}

const GOOGLE_TOKEN_EXCHANGE_MODE = parseTokenExchangeMode(
  process.env.AUTH0_GOOGLE_TOKEN_EXCHANGE_MODE,
  hasTokenVaultM2MConfig() ? 'access' : 'refresh',
);

const buildGoogleSubjectExchangeConfig = () =>
  GOOGLE_TOKEN_EXCHANGE_MODE === 'access'
    ? {
        accessToken: getTokenVaultSubjectAccessToken,
        subjectTokenType: SUBJECT_TOKEN_TYPE_ACCESS_TOKEN,
        loginHint: resolveTokenVaultLoginHint,
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
export const CAL_COM_TOKEN_VAULT_CONNECTION = process.env.AUTH0_CAL_CONNECTION || 'cal';
export const SLACK_TOKEN_EXCHANGE_MODE = parseTokenExchangeMode(
  process.env.AUTH0_SLACK_TOKEN_EXCHANGE_MODE,
  hasTokenVaultM2MConfig() ? 'access' : 'refresh',
);
export const CAL_COM_TOKEN_EXCHANGE_MODE = parseTokenExchangeMode(
  process.env.AUTH0_CAL_TOKEN_EXCHANGE_MODE,
  hasTokenVaultM2MConfig() ? 'access' : 'refresh',
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
const GOOGLE_ACCESS_TOKEN_SOURCE_MODE = parseGoogleAccessTokenSourceMode(process.env.AUTH0_GOOGLE_ACCESS_TOKEN_SOURCE);
const SHOULD_BYPASS_GOOGLE_TOKEN_VAULT = GOOGLE_ACCESS_TOKEN_SOURCE_MODE === 'token_exchange';
const SLACK_ACCESS_TOKEN_SOURCE_MODE = parseSlackAccessTokenSourceMode(process.env.AUTH0_SLACK_ACCESS_TOKEN_SOURCE);
const SHOULD_BYPASS_SLACK_TOKEN_VAULT = SLACK_ACCESS_TOKEN_SOURCE_MODE === 'token_exchange';

const passthroughToolWrapper = <T>(toolDefinition: T): T => toolDefinition;

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

type SlackAccessTokenOptions = {
  loginHint?: string;
  allowTokenVaultFallback?: boolean;
};

async function resolveSlackAccessTokenViaTokenExchange(loginHint?: string): Promise<string> {
  const refreshToken = await getRefreshToken().catch(() => undefined);
  if (refreshToken) {
    return exchangeSubjectTokenForConnectionAccessToken({
      subjectToken: refreshToken,
      subjectTokenType: SUBJECT_TOKEN_TYPE_REFRESH_TOKEN,
      connection: SLACK_TOKEN_VAULT_CONNECTION,
    });
  }

  if (loginHint) {
    const storedRefreshToken = await getAuth0SubjectRefreshToken(loginHint).catch(() => null);
    if (storedRefreshToken) {
      return exchangeSubjectTokenForConnectionAccessToken({
        subjectToken: storedRefreshToken,
        subjectTokenType: SUBJECT_TOKEN_TYPE_REFRESH_TOKEN,
        connection: SLACK_TOKEN_VAULT_CONNECTION,
      });
    }
  }

  const subjectAccessToken = await getTokenVaultSubjectAccessToken();
  return exchangeSubjectTokenForConnectionAccessToken({
    subjectToken: subjectAccessToken,
    subjectTokenType: SUBJECT_TOKEN_TYPE_ACCESS_TOKEN,
    connection: SLACK_TOKEN_VAULT_CONNECTION,
    loginHint,
  });
}

async function resolveRawSlackAccessToken(options?: SlackAccessTokenOptions): Promise<string> {
  const loginHint = asString(options?.loginHint) ?? resolveTokenVaultLoginHint(options ?? {});
  const allowTokenVaultFallback = options?.allowTokenVaultFallback !== false;

  // Automation/headless runs must not require interactive Token Vault authorization.
  const effectiveSourceMode: SlackAccessTokenSourceMode =
    !allowTokenVaultFallback && SLACK_ACCESS_TOKEN_SOURCE_MODE === 'token_vault'
      ? 'auto'
      : SLACK_ACCESS_TOKEN_SOURCE_MODE;

  if (effectiveSourceMode === 'token_vault') {
    return getAccessTokenFromTokenVault();
  }

  if (effectiveSourceMode === 'token_exchange') {
    return resolveSlackAccessTokenViaTokenExchange(loginHint);
  }

  // AUTO MODE: prefer token exchange, fall back to Token Vault only when allowed.
  try {
    return await resolveSlackAccessTokenViaTokenExchange(loginHint);
  } catch (error) {
    if (!allowTokenVaultFallback) {
      throw error;
    }

    return getAccessTokenFromTokenVault();
  }
}

export const getSlackAccessToken = async (options?: SlackAccessTokenOptions) => resolveRawSlackAccessToken(options);

type GoogleAccessTokenOptions = {
  loginHint?: string;
  allowTokenVaultFallback?: boolean;
};

async function resolveGoogleAccessTokenViaTokenExchange(loginHint?: string): Promise<string> {
  // Prefer refresh-token exchange when we have a real user refresh token (session-driven).
  const refreshToken = await getRefreshToken().catch(() => undefined);
  if (refreshToken) {
    return exchangeSubjectTokenForConnectionAccessToken({
      subjectToken: refreshToken,
      subjectTokenType: SUBJECT_TOKEN_TYPE_REFRESH_TOKEN,
      connection: GOOGLE_TOKEN_VAULT_CONNECTION,
    });
  }

  // Headless mode: use a stored subject refresh token keyed by the Auth0 user id.
  // This matches the “simple” polling architecture where we persist a long-lived refresh token once.
  if (loginHint) {
    const storedRefreshToken = await getAuth0SubjectRefreshToken(loginHint).catch(() => null);
    if (storedRefreshToken) {
      return exchangeSubjectTokenForConnectionAccessToken({
        subjectToken: storedRefreshToken,
        subjectTokenType: SUBJECT_TOKEN_TYPE_REFRESH_TOKEN,
        connection: GOOGLE_TOKEN_VAULT_CONNECTION,
      });
    }
  }

  // Headless mode: use privileged-worker exchange via a JWT access token + login hint.
  const subjectAccessToken = await getTokenVaultSubjectAccessToken();
  return exchangeSubjectTokenForConnectionAccessToken({
    subjectToken: subjectAccessToken,
    subjectTokenType: SUBJECT_TOKEN_TYPE_ACCESS_TOKEN,
    connection: GOOGLE_TOKEN_VAULT_CONNECTION,
    loginHint,
  });
}

async function resolveRawGoogleAccessToken(options?: GoogleAccessTokenOptions): Promise<string> {
  const loginHint = asString(options?.loginHint) ?? resolveTokenVaultLoginHint(options ?? {});
  const allowTokenVaultFallback = options?.allowTokenVaultFallback !== false;

  // Automation/headless runs must not require interactive Token Vault authorization.
  // If a deployment is configured with AUTH0_GOOGLE_ACCESS_TOKEN_SOURCE=token_vault,
  // override to AUTO so we attempt federated token exchange and fail fast when unavailable.
  const effectiveSourceMode: GoogleAccessTokenSourceMode =
    !allowTokenVaultFallback && GOOGLE_ACCESS_TOKEN_SOURCE_MODE === 'token_vault'
      ? 'auto'
      : GOOGLE_ACCESS_TOKEN_SOURCE_MODE;

  if (effectiveSourceMode === 'token_vault') {
    return getAccessTokenFromTokenVault();
  }

  if (effectiveSourceMode === 'token_exchange') {
    return resolveGoogleAccessTokenViaTokenExchange(loginHint);
  }

  // AUTO MODE: Prefer token exchange to keep automations cookie-independent.
  // Fall back to Token Vault only when allowed (interactive flows).
  try {
    return await resolveGoogleAccessTokenViaTokenExchange(loginHint);
  } catch (error) {
    if (!allowTokenVaultFallback) {
      throw error;
    }

    return getAccessTokenFromTokenVault();
  }
}

export const getGoogleAccessToken = async (options?: GoogleAccessTokenOptions) => {
  const accessToken = await resolveRawGoogleAccessToken(options);

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

type CalComAccessTokenOptions = {
  loginHint?: string;
  allowTokenVaultFallback?: boolean;
};

async function resolveCalComAccessTokenViaTokenExchange(loginHint?: string): Promise<string> {
  const refreshToken = await getRefreshToken().catch(() => undefined);
  if (refreshToken) {
    return exchangeSubjectTokenForConnectionAccessToken({
      subjectToken: refreshToken,
      subjectTokenType: SUBJECT_TOKEN_TYPE_REFRESH_TOKEN,
      connection: CAL_COM_TOKEN_VAULT_CONNECTION,
    });
  }

  if (loginHint) {
    const storedRefreshToken = await getAuth0SubjectRefreshToken(loginHint).catch(() => null);
    if (storedRefreshToken) {
      return exchangeSubjectTokenForConnectionAccessToken({
        subjectToken: storedRefreshToken,
        subjectTokenType: SUBJECT_TOKEN_TYPE_REFRESH_TOKEN,
        connection: CAL_COM_TOKEN_VAULT_CONNECTION,
      });
    }
  }

  const subjectAccessToken = await getTokenVaultSubjectAccessToken();
  return exchangeSubjectTokenForConnectionAccessToken({
    subjectToken: subjectAccessToken,
    subjectTokenType: SUBJECT_TOKEN_TYPE_ACCESS_TOKEN,
    connection: CAL_COM_TOKEN_VAULT_CONNECTION,
    loginHint,
  });
}

async function resolveRawCalComAccessToken(options?: CalComAccessTokenOptions): Promise<string> {
  const loginHint = asString(options?.loginHint) ?? resolveTokenVaultLoginHint(options ?? {});
  const allowTokenVaultFallback = options?.allowTokenVaultFallback !== false;

  // Prefer token exchange to keep automations cookie-independent.
  try {
    return await resolveCalComAccessTokenViaTokenExchange(loginHint);
  } catch (error) {
    if (!allowTokenVaultFallback) {
      throw error;
    }

    // Only safe to call inside an auth0AI.withTokenVault wrapper.
    return getAccessTokenFromTokenVault();
  }
}

export const getCalComAccessToken = async (options?: CalComAccessTokenOptions) => resolveRawCalComAccessToken(options);

const auth0AI = new Auth0AI();

const withGoogleTokenVaultOrBypass = SHOULD_BYPASS_GOOGLE_TOKEN_VAULT
  ? passthroughToolWrapper
  : auth0AI.withTokenVault({
      connection: GOOGLE_TOKEN_VAULT_CONNECTION,
      scopes: GOOGLE_UNIFIED_SCOPES,
      ...buildGoogleSubjectExchangeConfig(),
    });

const withDriveTokenVaultOrBypass = SHOULD_BYPASS_GOOGLE_TOKEN_VAULT
  ? passthroughToolWrapper
  : auth0AI.withTokenVault({
      connection: GOOGLE_TOKEN_VAULT_CONNECTION,
      scopes: DRIVE_READ_SCOPES,
      ...buildGoogleSubjectExchangeConfig(),
    });

export const withGoogle = withGoogleTokenVaultOrBypass;

// Connection for Google services
export const withGmailRead = withGoogleTokenVaultOrBypass;
export const withGmailWrite = withGoogleTokenVaultOrBypass;
export const withCalendar = withGoogleTokenVaultOrBypass;

const withSlackTokenVault = auth0AI.withTokenVault({
  connection: SLACK_TOKEN_VAULT_CONNECTION,
  scopes: SLACK_SCOPES,
  authorizationParams: SLACK_AUTHORIZATION_PARAMS,
  ...buildSubjectExchangeConfig(SLACK_TOKEN_EXCHANGE_MODE),
});

export const withSlack = SHOULD_BYPASS_SLACK_TOKEN_VAULT ? passthroughToolWrapper : withSlackTokenVault;
export const withCal = auth0AI.withTokenVault({
  connection: CAL_COM_TOKEN_VAULT_CONNECTION,
  scopes: CAL_COM_SCOPES,
  authorizationParams: CAL_COM_AUTHORIZATION_PARAMS,
  ...buildSubjectExchangeConfig(CAL_COM_TOKEN_EXCHANGE_MODE),
});

export const withDrive = withDriveTokenVaultOrBypass;
