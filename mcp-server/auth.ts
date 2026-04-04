import { UserError } from 'fastmcp';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type http from 'node:http';

import type { McpSessionAuth } from './types';

const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stripSurroundingQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRoleToken(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('founder')) {
    return 'founder';
  }

  if (
    normalized.includes('hiring_manager') ||
    normalized.includes('hiringmanager') ||
    normalized === 'manager' ||
    normalized.endsWith('_manager')
  ) {
    return 'hiring_manager';
  }

  return normalized;
}

function collectRoleTokens(payload: JWTPayload): string[] {
  const payloadRecord = payload as Record<string, unknown>;
  const roleTokens = new Set<string>();

  const addRoleToken = (value: unknown) => {
    const token = asString(value);
    if (!token) {
      return;
    }

    const normalized = normalizeRoleToken(token);
    if (normalized) {
      roleTokens.add(normalized);
    }
  };

  const addRoleTokenArray = (value: unknown) => {
    for (const token of asStringArray(value)) {
      const normalized = normalizeRoleToken(token);
      if (normalized) {
        roleTokens.add(normalized);
      }
    }
  };

  addRoleToken(payloadRecord.role);
  addRoleTokenArray(payloadRecord.roles);

  const appMetadata = asRecord(payloadRecord.app_metadata);
  addRoleToken(appMetadata?.role);
  addRoleTokenArray(appMetadata?.roles);

  for (const [key, value] of Object.entries(payloadRecord)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.endsWith('/role')) {
      addRoleToken(value);
    }

    if (lowerKey.endsWith('/roles')) {
      addRoleTokenArray(value);
    }
  }

  return Array.from(roleTokens);
}

function collectScopes(payload: JWTPayload): string[] {
  const scope = asString((payload as Record<string, unknown>).scope);
  if (!scope) {
    return [];
  }

  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveOrgId(payload: JWTPayload): string | undefined {
  const payloadRecord = payload as Record<string, unknown>;
  const directOrgId = asString(payloadRecord.org_id) ?? asString(payloadRecord.organization_id);
  if (directOrgId) {
    return directOrgId;
  }

  for (const [key, value] of Object.entries(payloadRecord)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.endsWith('/org_id') || lowerKey.endsWith('/organization_id')) {
      const parsed = asString(value);
      if (parsed) {
        return parsed;
      }
    }
  }

  return undefined;
}

function parseBearerToken(authorizationHeader: string | string[] | undefined): string {
  const headerValue = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  const normalizedHeader = asString(headerValue);

  if (!normalizedHeader) {
    throw new UserError('Missing bearer token. Pass Authorization: Bearer <access_token>.');
  }

  const matched = BEARER_TOKEN_PATTERN.exec(normalizedHeader);
  if (!matched?.[1]) {
    throw new UserError('Malformed Authorization header. Expected: Bearer <access_token>.');
  }

  return matched[1].trim();
}

function normalizeIssuer(value: string): string {
  const trimmed = stripSurroundingQuotes(value).replace(/\/+$/, '');
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function resolveIssuer(): string {
  const issuer = process.env.MCP_AUTH_ISSUER?.trim() ?? process.env.AUTH0_DOMAIN?.trim();
  if (!issuer) {
    throw new Error('Missing Auth0 issuer. Set MCP_AUTH_ISSUER or AUTH0_DOMAIN.');
  }

  return normalizeIssuer(issuer);
}

function resolveAudiences(): string[] {
  const audienceRaw =
    stripSurroundingQuotes(process.env.MCP_AUTH_AUDIENCE?.trim() ?? '') ||
    stripSurroundingQuotes(process.env.AUTH0_AUDIENCE?.trim() ?? '');
  if (!audienceRaw) {
    return [];
  }

  return audienceRaw
    .split(',')
    .map((value) => stripSurroundingQuotes(value))
    .filter(Boolean);
}

function buildSessionAuth(payload: JWTPayload, token: string): McpSessionAuth {
  const userId = asString((payload as Record<string, unknown>).sub);

  if (!userId) {
    throw new UserError('Token validated but is missing the sub claim.');
  }

  return {
    userId,
    orgId: resolveOrgId(payload),
    roles: collectRoleTokens(payload),
    scope: collectScopes(payload),
    token,
    claims: payload,
  };
}

function resolveUserInfoEndpoint(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/userinfo`;
}

async function verifyViaUserInfo(issuer: string, token: string): Promise<JWTPayload | null> {
  try {
    const response = await fetch(resolveUserInfoEndpoint(issuer), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    const payloadRecord = asRecord(payload);
    const sub = asString(payloadRecord?.sub);
    if (!payloadRecord || !sub) {
      return null;
    }

    return payloadRecord as JWTPayload;
  } catch {
    return null;
  }
}

function resolveDevRoleList(): string[] {
  const raw = process.env.MCP_DEV_ROLES?.trim();
  if (!raw) {
    return ['founder'];
  }

  return raw
    .split(',')
    .map((value) => normalizeRoleToken(value))
    .filter((value): value is string => Boolean(value));
}

function buildDevSessionAuth(): McpSessionAuth {
  const userId = process.env.MCP_DEV_USER_ID?.trim();
  if (!userId) {
    throw new UserError(
      'No HTTP request context found. For stdio development, set MCP_DEV_USER_ID (or use HTTP transport with Bearer auth).',
    );
  }

  const orgId = process.env.MCP_DEV_ORG_ID?.trim() || undefined;
  const claims: JWTPayload = {
    sub: userId,
    ...(orgId ? { org_id: orgId } : {}),
  };

  return {
    userId,
    orgId,
    roles: resolveDevRoleList(),
    scope: [],
    token: 'dev-stdio-token',
    claims,
  };
}

export function createAuth0Authenticator() {
  const issuer = resolveIssuer();
  const audiences = resolveAudiences();

  if (process.env.NODE_ENV === 'production' && audiences.length === 0) {
    throw new Error('Missing MCP_AUTH_AUDIENCE in production.');
  }

  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (request: http.IncomingMessage): Promise<McpSessionAuth> => {
    if (!request) {
      return buildDevSessionAuth();
    }

    const token = parseBearerToken(request.headers.authorization);

    try {
      const verifyOptions: {
        audience?: string | string[];
        issuer: string;
      } = { issuer };

      if (audiences.length === 1) {
        verifyOptions.audience = audiences[0];
      } else if (audiences.length > 1) {
        verifyOptions.audience = audiences;
      }

      const { payload } = await jwtVerify(token, jwks, verifyOptions);
      return buildSessionAuth(payload, token);
    } catch (error) {
      if (error instanceof UserError) {
        throw error;
      }

      const payload = await verifyViaUserInfo(issuer, token);
      if (payload) {
        return buildSessionAuth(payload, token);
      }

      const message = error instanceof Error ? error.message : 'token verification failed';
      throw new UserError(`Unauthorized: ${message}`);
    }
  };
}
