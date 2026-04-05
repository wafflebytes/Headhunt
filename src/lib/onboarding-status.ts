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
};

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
    logOnboardingStatusSnapshotFailure(error);
    return {
      statuses: buildDisconnectedStatuses(origin),
      degraded: true,
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
  };
}

export async function getOnboardingIntegrationStatuses(origin: string): Promise<OnboardingIntegrationStatus[]> {
  const snapshot = await getOnboardingIntegrationStatusSnapshot(origin);
  return snapshot.statuses;
}

export const areAllRequiredIntegrationsConnected = (statuses: OnboardingIntegrationStatus[]) => {
  return statuses.every((status) => status.connected);
};
