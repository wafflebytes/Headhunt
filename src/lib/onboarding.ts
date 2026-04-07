export const ONBOARDING_COOKIE_NAME = 'hh_onboarding_complete_user';
export const ONBOARDING_RETURN_TO = '/onboarding';

export type OnboardingIntegrationId = 'google' | 'cal' | 'slack';

export type RequiredOnboardingConnection = {
  id: OnboardingIntegrationId;
  connection: string;
  requiredScopes: string[];
  authorizationParams: Record<string, string>;
};

const DEFAULT_GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
];

const DEFAULT_CAL_SCOPES = [
  'PROFILE_READ',
  'SCHEDULE_READ',
  'SCHEDULE_WRITE',
  'BOOKING_READ',
  'BOOKING_WRITE',
  'EVENT_TYPE_READ',
  'EVENT_TYPE_WRITE',
];

const DEFAULT_SLACK_SCOPES = ['channels:read', 'channels:history', 'chat:write'];

const uniqueScopes = (scopes: string[]) => Array.from(new Set(scopes));

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

const parseAuthorizationParams = (
  raw: string | undefined,
  fallback: Record<string, string> = {},
): Record<string, string> => {
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
    // Fall back to key=value parsing below.
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

export const getRequiredOnboardingConnections = (): RequiredOnboardingConnection[] => {
  const googleConnection = process.env.AUTH0_GOOGLE_CONNECTION || 'google-oauth2';
  const calConnection = process.env.AUTH0_CAL_CONNECTION || 'cal';
  const slackConnection = process.env.AUTH0_SLACK_CONNECTION || 'sign-in-with-slack';

  return [
    {
      id: 'google',
      connection: googleConnection,
      requiredScopes: uniqueScopes(parseScopes(process.env.AUTH0_GOOGLE_SCOPES, DEFAULT_GOOGLE_SCOPES)),
      authorizationParams: parseAuthorizationParams(process.env.AUTH0_GOOGLE_AUTHORIZATION_PARAMS),
    },
    {
      id: 'cal',
      connection: calConnection,
      requiredScopes: uniqueScopes(parseScopes(process.env.AUTH0_CAL_SCOPES, DEFAULT_CAL_SCOPES)),
      authorizationParams: parseAuthorizationParams(process.env.AUTH0_CAL_AUTHORIZATION_PARAMS, { prompt: 'consent' }),
    },
    {
      id: 'slack',
      connection: slackConnection,
      requiredScopes: uniqueScopes(parseScopes(process.env.AUTH0_SLACK_SCOPES, DEFAULT_SLACK_SCOPES)),
      authorizationParams: parseAuthorizationParams(process.env.AUTH0_SLACK_AUTHORIZATION_PARAMS, { prompt: 'consent' }),
    },
  ];
};

export const normalizeRequiredScopes = (scopes: string[]) => scopes.filter((scope) => scope !== 'openid');

export const buildConnectionConnectUrl = (origin: string, connection: RequiredOnboardingConnection) => {
  const url = new URL('/auth/connect', origin);
  url.searchParams.set('connection', connection.connection);
  url.searchParams.set('returnTo', ONBOARDING_RETURN_TO);

  for (const scope of connection.requiredScopes) {
    url.searchParams.append('scopes', scope);
  }

  for (const [key, value] of Object.entries(connection.authorizationParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
};

export const serializeOnboardingCookieValue = (userSub: string) => encodeURIComponent(userSub);

export const isOnboardingCookieCompleteForUser = (
  cookieValue: string | undefined,
  userSub: string | undefined,
): boolean => {
  if (!cookieValue || !userSub) {
    return false;
  }

  return cookieValue === serializeOnboardingCookieValue(userSub);
};
