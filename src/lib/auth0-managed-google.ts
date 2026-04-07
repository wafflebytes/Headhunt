import { TokenVaultError } from '@auth0/ai/interrupts';

import { getUser } from './auth0';

const MANAGEMENT_TOKEN_EXPIRY_SKEW_MS = 30_000;

const asString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

type Auth0ManagementTokenResponse = {
	access_token?: unknown;
	expires_in?: unknown;
	error?: unknown;
	error_description?: unknown;
};

type Auth0FederatedConnectionTokenset = {
	id?: unknown;
	connection?: unknown;
	access_token?: unknown;
	refresh_token?: unknown;
	token_set?: unknown;
	tokens?: unknown;
	token?: unknown;
};

type Auth0TokenContainer = {
	access_token?: unknown;
	refresh_token?: unknown;
};

type ManagementApiTokenCache = {
	accessToken: string;
	expiresAtEpochMs: number;
};

let managementApiTokenCache: ManagementApiTokenCache | null = null;
let managementApiTokenInflight: Promise<string> | null = null;

function normalizeAuth0Domain(rawDomain: string): string {
	return rawDomain.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
}

function resolveAuth0Domain(): string | null {
	const configured = asString(process.env.AUTH0_DOMAIN);
	if (!configured) {
		return null;
	}

	return normalizeAuth0Domain(configured);
}

function resolveManagementAudience(domain: string): string {
	return asString(process.env.AUTH0_MANAGEMENT_AUDIENCE) ?? `https://${domain}/api/v2/`;
}

function resolveManagementClientId(): string | null {
	return (
		asString(process.env.AUTH0_MANAGEMENT_CLIENT_ID) ??
		asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_ID) ??
		asString(process.env.AUTH0_CLIENT_ID) ??
		null
	);
}

function resolveManagementClientSecret(): string | null {
	return (
		asString(process.env.AUTH0_MANAGEMENT_CLIENT_SECRET) ??
		asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET) ??
		asString(process.env.AUTH0_CLIENT_SECRET) ??
		null
	);
}

function resolveManagementScope(): string | undefined {
	return asString(process.env.AUTH0_MANAGEMENT_SCOPE);
}

type ManagementClientCredentials = {
	label: string;
	clientId: string;
	clientSecret: string;
};

const REQUIRED_FEDERATED_TOKENSET_SCOPE = 'read:federated_connections_tokens';

function resolveManagementClientCredentialsCandidates(): ManagementClientCredentials[] {
	const candidates: ManagementClientCredentials[] = [];

	const managementClientId = asString(process.env.AUTH0_MANAGEMENT_CLIENT_ID);
	const managementClientSecret = asString(process.env.AUTH0_MANAGEMENT_CLIENT_SECRET);
	if (managementClientId && managementClientSecret) {
		candidates.push({
			label: 'AUTH0_MANAGEMENT_CLIENT_*',
			clientId: managementClientId,
			clientSecret: managementClientSecret,
		});
	}

	const tokenVaultClientId = asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_ID);
	const tokenVaultClientSecret = asString(process.env.AUTH0_TOKEN_VAULT_M2M_CLIENT_SECRET);
	if (tokenVaultClientId && tokenVaultClientSecret) {
		candidates.push({
			label: 'AUTH0_TOKEN_VAULT_M2M_*',
			clientId: tokenVaultClientId,
			clientSecret: tokenVaultClientSecret,
		});
	}

	const appClientId = asString(process.env.AUTH0_CLIENT_ID);
	const appClientSecret = asString(process.env.AUTH0_CLIENT_SECRET);
	if (appClientId && appClientSecret) {
		candidates.push({
			label: 'AUTH0_CLIENT_*',
			clientId: appClientId,
			clientSecret: appClientSecret,
		});
	}

	const unique: ManagementClientCredentials[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const key = `${candidate.clientId}:${candidate.clientSecret}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(candidate);
	}

	return unique;
}

function resolveManagementScopeCandidates(): string[] {
	const configured = resolveManagementScope();
	const candidates: string[] = [];

	if (configured) {
		const normalized = configured
			.replace(/,/g, ' ')
			.split(/\s+/)
			.map((scope) => scope.trim())
			.filter(Boolean);

		const unique = Array.from(new Set(normalized));
		if (!unique.includes(REQUIRED_FEDERATED_TOKENSET_SCOPE)) {
			unique.push(REQUIRED_FEDERATED_TOKENSET_SCOPE);
		}

		candidates.push(unique.join(' '));
	}

	candidates.push(REQUIRED_FEDERATED_TOKENSET_SCOPE);

	return Array.from(new Set(candidates));
}

function resolveGoogleConnection(): string {
	return asString(process.env.AUTH0_MANAGEMENT_GOOGLE_CONNECTION) ?? asString(process.env.AUTH0_GOOGLE_CONNECTION) ?? 'google-oauth2';
}

function resolveGoogleOauthClientId(): string | undefined {
	return asString(process.env.AUTH0_GOOGLE_OAUTH_CLIENT_ID) ?? asString(process.env.GOOGLE_OAUTH_CLIENT_ID);
}

function resolveGoogleOauthClientSecret(): string | undefined {
	return asString(process.env.AUTH0_GOOGLE_OAUTH_CLIENT_SECRET) ?? asString(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function canExchangeGoogleRefreshToken(): boolean {
	return Boolean(resolveGoogleOauthClientId() && resolveGoogleOauthClientSecret());
}

export function hasGoogleManagementTokenConfig(): boolean {
	return Boolean(resolveAuth0Domain() && resolveManagementClientId() && resolveManagementClientSecret());
}

function isAuth0UserId(value: string): boolean {
	return value.includes('|');
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

async function fetchManagementApiAccessToken(): Promise<string> {
	const domain = resolveAuth0Domain();

	if (!domain) {
		throw new TokenVaultError('AUTH0_DOMAIN is required for Management API token flow.');
	}

	const credentialCandidates = resolveManagementClientCredentialsCandidates();
	if (credentialCandidates.length === 0) {
		throw new TokenVaultError(
			'Missing Management API credentials. Set AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET (or reuse AUTH0_CLIENT_ID/AUTH0_CLIENT_SECRET or AUTH0_TOKEN_VAULT_M2M_*).',
		);
	}

	if (
		managementApiTokenCache &&
		managementApiTokenCache.expiresAtEpochMs - MANAGEMENT_TOKEN_EXPIRY_SKEW_MS > Date.now()
	) {
		return managementApiTokenCache.accessToken;
	}

	if (managementApiTokenInflight) {
		return managementApiTokenInflight;
	}

	managementApiTokenInflight = (async () => {
		const audience = resolveManagementAudience(domain);
		const scopeCandidates = resolveManagementScopeCandidates();

		let lastError: unknown = null;

		for (const credentials of credentialCandidates) {
			for (const scope of scopeCandidates) {
				try {
					const response = await fetch(`https://${domain}/oauth/token`, {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
						},
						body: JSON.stringify({
							grant_type: 'client_credentials',
							client_id: credentials.clientId,
							client_secret: credentials.clientSecret,
							audience,
							scope,
						}),
					});

					const raw = await response.text();
					let parsed: Auth0ManagementTokenResponse = {};
					try {
						parsed = JSON.parse(raw) as Auth0ManagementTokenResponse;
					} catch {
						parsed = {};
					}

					if (!response.ok) {
						lastError = new TokenVaultError(
							`Failed to obtain Auth0 Management API token using ${credentials.label} (status ${response.status}): ${
								asString(parsed.error_description) ??
								asString(parsed.error) ??
								(raw || 'unknown error')
							}`,
						);
						continue;
					}

					const accessToken = asString(parsed.access_token);
					if (!accessToken) {
						lastError = new TokenVaultError(
							`Auth0 Management API token response did not include access_token using ${credentials.label}.`,
						);
						continue;
					}

					const expiresInSeconds =
						typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
							? Math.max(60, Math.floor(parsed.expires_in))
							: 300;

					managementApiTokenCache = {
						accessToken,
						expiresAtEpochMs: Date.now() + expiresInSeconds * 1000,
					};

					return accessToken;
				} catch (error) {
					lastError = error;
				}
			}
		}

		if (lastError instanceof Error) {
			throw lastError;
		}

		throw new TokenVaultError('Failed to obtain Auth0 Management API token.');
	})().finally(() => {
		managementApiTokenInflight = null;
	});

	return managementApiTokenInflight;
}

async function managementApiFetch(pathnameWithQuery: string) {
	const domain = resolveAuth0Domain();
	if (!domain) {
		throw new TokenVaultError('AUTH0_DOMAIN is required for Management API token flow.');
	}

	const accessToken = await fetchManagementApiAccessToken();
	const response = await fetch(`https://${domain}${pathnameWithQuery}`, {
		method: 'GET',
		headers: {
			authorization: `Bearer ${accessToken}`,
			'content-type': 'application/json',
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new TokenVaultError(
			`Management API request failed for ${pathnameWithQuery} (status ${response.status}): ${body || 'unknown error'}`,
		);
	}

	return response.json();
}

async function resolveTargetUserId(loginHint?: string): Promise<string> {
	const explicitUserId = asString(process.env.AUTH0_MANAGEMENT_USER_ID);
	if (explicitUserId) {
		return explicitUserId;
	}

	const hinted = asString(loginHint) ?? asString(process.env.AUTH0_TOKEN_VAULT_LOGIN_HINT);
	if (hinted && isAuth0UserId(hinted)) {
		return hinted;
	}

	const user = await getUser().catch(() => undefined);
	const sessionUserId = asString(user?.sub);
	if (sessionUserId) {
		return sessionUserId;
	}

	const emailHint = hinted ?? asString(user?.email);
	if (!emailHint) {
		throw new TokenVaultError(
			'Management API token flow requires AUTH0_MANAGEMENT_USER_ID or a login hint/user email to resolve the target account.',
		);
	}

	const normalizedEmail = normalizeEmail(emailHint);
	let users: Array<{ user_id?: unknown }> = [];

	try {
		users = (await managementApiFetch(
			`/api/v2/users-by-email?email=${encodeURIComponent(normalizedEmail)}`,
		)) as Array<{ user_id?: unknown }>;
	} catch {
		throw new TokenVaultError(
			'Unable to resolve Auth0 user by email via Management API. Set AUTH0_MANAGEMENT_USER_ID for cron flows, or include read:users in AUTH0_MANAGEMENT_SCOPE.',
		);
	}

	const targetUserId = Array.isArray(users) ? asString(users[0]?.user_id) : undefined;
	if (!targetUserId) {
		throw new TokenVaultError(`No Auth0 user found for email ${normalizedEmail}.`);
	}

	return targetUserId;
}

function asTokenContainer(value: unknown): Auth0TokenContainer | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	return value as Auth0TokenContainer;
}

function readFederatedTokenValue(
	tokenset: Auth0FederatedConnectionTokenset,
	field: 'access_token' | 'refresh_token',
): string | undefined {
	const directValue = asString(tokenset[field]);
	if (directValue) {
		return directValue;
	}

	const nestedCandidates = [tokenset.token_set, tokenset.tokens, tokenset.token];
	for (const nestedCandidate of nestedCandidates) {
		const nested = asTokenContainer(nestedCandidate);
		const nestedValue = asString(nested?.[field]);
		if (nestedValue) {
			return nestedValue;
		}
	}

	return undefined;
}

function findGoogleTokenSet(
	tokenSets: Auth0FederatedConnectionTokenset[],
	connection: string,
): Auth0FederatedConnectionTokenset | null {
	const normalizedConnection = connection.toLowerCase();
	const matchingTokenSets = tokenSets.filter(
		(tokenset) => asString(tokenset.connection)?.toLowerCase() === normalizedConnection,
	);

	if (matchingTokenSets.length === 0) {
		return null;
	}

	const withRefreshToken = matchingTokenSets.find((tokenset) =>
		Boolean(readFederatedTokenValue(tokenset, 'refresh_token')),
	);
	if (withRefreshToken) {
		return withRefreshToken;
	}

	const withAccessToken = matchingTokenSets.find((tokenset) =>
		Boolean(readFederatedTokenValue(tokenset, 'access_token')),
	);
	if (withAccessToken) {
		return withAccessToken;
	}

	return matchingTokenSets[0] ?? null;
}

function listConnections(tokenSets: Auth0FederatedConnectionTokenset[]): string[] {
	const connections = new Set<string>();

	for (const tokenset of tokenSets) {
		const connection = asString(tokenset.connection);
		if (connection) {
			connections.add(connection);
		}
	}

	return Array.from(connections).sort();
}

async function exchangeGoogleRefreshToken(refreshToken: string): Promise<string> {
	const clientId = resolveGoogleOauthClientId();
	const clientSecret = resolveGoogleOauthClientSecret();

	if (!clientId || !clientSecret) {
		throw new TokenVaultError(
			'Google refresh-token exchange requires AUTH0_GOOGLE_OAUTH_CLIENT_ID and AUTH0_GOOGLE_OAUTH_CLIENT_SECRET (or GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET).',
		);
	}

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: clientId,
		client_secret: clientSecret,
		refresh_token: refreshToken,
	});

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: body.toString(),
	});

	if (!response.ok) {
		const payload = await response.text();
		throw new TokenVaultError(
			`Google refresh-token exchange failed (status ${response.status}): ${payload || 'unknown error'}`,
		);
	}

	const payload = (await response.json()) as { access_token?: unknown };
	const accessToken = asString(payload.access_token);

	if (!accessToken) {
		throw new TokenVaultError('Google refresh-token exchange did not return access_token.');
	}

	return accessToken;
}

export async function getGoogleAccessTokenFromManagementApi(params?: {
	loginHint?: string;
	connection?: string;
}): Promise<string> {
	const connection = asString(params?.connection) ?? resolveGoogleConnection();
	const userId = await resolveTargetUserId(params?.loginHint);

	const tokenSetsPayload = (await managementApiFetch(
		`/api/v2/users/${encodeURIComponent(userId)}/federated-connections-tokensets`,
	)) as unknown;
	const tokenSets = Array.isArray(tokenSetsPayload)
		? (tokenSetsPayload as Auth0FederatedConnectionTokenset[])
		: [];
	const googleTokenSet = findGoogleTokenSet(tokenSets, connection);

	if (!googleTokenSet) {
		const availableConnections = listConnections(tokenSets);
		const availableSummary =
			availableConnections.length > 0
				? ` Available connections: ${availableConnections.join(', ')}.`
				: '';
		throw new TokenVaultError(
			`No federated token set found for connection ${connection} on Auth0 user ${userId}.${availableSummary} Reconnect Google and retry.`,
		);
	}

	const refreshToken = readFederatedTokenValue(googleTokenSet, 'refresh_token');
	if (refreshToken) {
		if (canExchangeGoogleRefreshToken()) {
			try {
				return await exchangeGoogleRefreshToken(refreshToken);
			} catch (error) {
				const accessTokenFallback = readFederatedTokenValue(googleTokenSet, 'access_token');
				if (accessTokenFallback) {
					return accessTokenFallback;
				}

				throw error;
			}
		}

		const accessTokenFallback = readFederatedTokenValue(googleTokenSet, 'access_token');
		if (accessTokenFallback) {
			return accessTokenFallback;
		}

		throw new TokenVaultError(
			`Managed Google refresh token is present for user ${userId}, but Google OAuth client credentials are not configured for refresh-token exchange. Set AUTH0_GOOGLE_OAUTH_CLIENT_ID and AUTH0_GOOGLE_OAUTH_CLIENT_SECRET, or reconnect Google so Auth0 stores an access token in the federated token set.`,
		);
	}

	const accessToken = readFederatedTokenValue(googleTokenSet, 'access_token');
	if (accessToken) {
		return accessToken;
	}

	const tokenSetId = asString(googleTokenSet.id);
	const tokenSetLabel = tokenSetId ? ` ${tokenSetId}` : '';

	throw new TokenVaultError(
		`Federated token set${tokenSetLabel} for ${connection} on user ${userId} did not include refresh_token or access_token. Reconnect Google with offline consent and required scopes.`,
	);
}
