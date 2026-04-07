import {
  buildConnectionConnectUrl,
  getRequiredOnboardingConnections,
  normalizeRequiredScopes,
  type OnboardingIntegrationId,
} from '@/lib/onboarding';
import { auth0 } from '@/lib/auth0';

type ConnectedAccountSnapshot = {
  id: string;
  connection: string;
  scopes?: string[];
  access_type?: string;
  expires_at?: string;
};

export type OnboardingIntegrationStatus = {
  id: OnboardingIntegrationId;
  connection: string;
  connected: boolean;
  missingScopes: string[];
  connectUrl: string;
};

export type OnboardingIntegrationStatusSnapshot = {
  statuses: OnboardingIntegrationStatus[];
  degraded: boolean;
  reauthRequired: boolean;
};

const REQUIRED_ONBOARDING_INTEGRATION_IDS: readonly OnboardingIntegrationId[] = ['google', 'slack'];

const CONNECTED_ACCOUNTS_AUDIENCE = `https://${process.env.AUTH0_DOMAIN}/me/`;
const CONNECTED_ACCOUNTS_ACCOUNTS_URL = `https://${process.env.AUTH0_DOMAIN}/me/v1/connected-accounts/accounts`;
const ONBOARDING_STATUS_LOG_COOLDOWN_MS = 60_000;

let lastOnboardingStatusErrorLogAt = 0;

const logOnboardingStatusSnapshotFailure = (error: unknown) => {
  const now = Date.now();
  if (now - lastOnboardingStatusErrorLogAt < ONBOARDING_STATUS_LOG_COOLDOWN_MS) {
    return;
  }

  lastOnboardingStatusErrorLogAt = now;
  console.warn(
    '[onboarding-status] Failed to load connected accounts snapshot; returning degraded onboarding status.',
    error,
  );
};

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object';
};

const collectErrorCodes = (error: unknown, codes: Set<string>) => {
  if (!isObjectLike(error)) {
    return;
  }

  const code = error.code;
  if (typeof code === 'string' && code.trim().length > 0) {
    codes.add(code.trim().toLowerCase());
  }

  const cause = error.cause;
  if (cause && cause !== error) {
    collectErrorCodes(cause, codes);
  }
};

const collectErrorMessages = (error: unknown, messages: string[]) => {
  if (typeof error === 'string') {
    const normalized = error.trim().toLowerCase();
    if (normalized) {
      messages.push(normalized);
    }
    return;
  }

  if (!isObjectLike(error)) {
    return;
  }

  const message = error.message;
  if (typeof message === 'string' && message.trim().length > 0) {
    messages.push(message.trim().toLowerCase());
  }

  const cause = error.cause;
  if (cause && cause !== error) {
    collectErrorMessages(cause, messages);
  }
};

const isAuthSessionRefreshFailure = (error: unknown) => {
  const codes = new Set<string>();
  collectErrorCodes(error, codes);

  if (codes.has('failed_to_refresh_token') || codes.has('invalid_grant')) {
    return true;
  }

  const messages: string[] = [];
  collectErrorMessages(error, messages);

  return messages.some((message) => {
    return (
      message.includes('failed_to_refresh_token') ||
      message.includes('invalid_grant') ||
      message.includes('unknown or invalid refresh token') ||
      message.includes('invalid refresh token')
    );
  });
};

const hasRefreshCapableAccess = (accounts: ConnectedAccountSnapshot[]): boolean => {
  return accounts.some((account) => {
    const accessType = (account.access_type ?? '').toLowerCase();
    return accessType.includes('offline') || accessType.includes('refresh');
  });
};

async function loadConnectedAccountsSnapshot(): Promise<ConnectedAccountSnapshot[]> {
  const { token } = await auth0.getAccessToken({
    audience: CONNECTED_ACCOUNTS_AUDIENCE,
    scope: 'read:me:connected_accounts',
  });

  if (!token) {
    throw new Error('Missing My Account API token for onboarding checks.');
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

function buildDisconnectedStatuses(origin: string): OnboardingIntegrationStatus[] {
  return getRequiredOnboardingConnections().map((requiredConnection) => ({
    id: requiredConnection.id,
    connection: requiredConnection.connection,
    connected: false,
    missingScopes: normalizeRequiredScopes(requiredConnection.requiredScopes),
    connectUrl: buildConnectionConnectUrl(origin, requiredConnection),
  }));
}

export async function getOnboardingIntegrationStatusSnapshot(origin: string): Promise<OnboardingIntegrationStatusSnapshot> {
  let accounts: ConnectedAccountSnapshot[];
  try {
    accounts = await loadConnectedAccountsSnapshot();
  } catch (error) {
    const reauthRequired = isAuthSessionRefreshFailure(error);
    logOnboardingStatusSnapshotFailure(error);
    return {
      statuses: buildDisconnectedStatuses(origin),
      degraded: true,
      reauthRequired,
    };
  }

  const statuses = getRequiredOnboardingConnections().map((requiredConnection) => {
    const connectionAccounts = accounts.filter((account) => account.connection === requiredConnection.connection);

    if (connectionAccounts.length === 0) {
      return {
        id: requiredConnection.id,
        connection: requiredConnection.connection,
        connected: false,
        missingScopes: normalizeRequiredScopes(requiredConnection.requiredScopes),
        connectUrl: buildConnectionConnectUrl(origin, requiredConnection),
      };
    }

    const requiredScopes = normalizeRequiredScopes(requiredConnection.requiredScopes);
    const grantedScopeSet = new Set(connectionAccounts.flatMap((account) => account.scopes ?? []));
    const missingScopes = requiredScopes.filter((scope) => !grantedScopeSet.has(scope));

    const requiresOfflineAccess = requiredScopes.includes('offline_access');
    const hasOfflineAccessType = hasRefreshCapableAccess(connectionAccounts);

    const connected = missingScopes.length === 0 && (!requiresOfflineAccess || hasOfflineAccessType);

    return {
      id: requiredConnection.id,
      connection: requiredConnection.connection,
      connected,
      missingScopes,
      connectUrl: buildConnectionConnectUrl(origin, requiredConnection),
    };
  });

  return {
    statuses,
    degraded: false,
    reauthRequired: false,
  };
}

export async function getOnboardingIntegrationStatuses(origin: string): Promise<OnboardingIntegrationStatus[]> {
  const snapshot = await getOnboardingIntegrationStatusSnapshot(origin);
  return snapshot.statuses;
}

export const areAllRequiredIntegrationsConnected = (statuses: OnboardingIntegrationStatus[]) => {
  const connectedByIntegration = new Map(statuses.map((status) => [status.id, status.connected]));

  return REQUIRED_ONBOARDING_INTEGRATION_IDS.every(
    (requiredIntegrationId) => connectedByIntegration.get(requiredIntegrationId) === true,
  );
};
