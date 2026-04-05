type CibaBaseConfig = {
  domain: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  scope: string;
  issuer: string;
};

export type CibaInitiationInput = {
  founderUserId: string;
  bindingMessage: string;
  requestedExpirySeconds?: number;
  audience?: string;
  scope?: string;
};

export type CibaInitiationResult = {
  authReqId: string;
  expiresInSeconds: number;
  intervalSeconds: number;
  requestedAtISO: string;
  expiresAtISO: string;
};

export type CibaPollResult =
  | {
      status: 'pending';
      pollAfterSeconds: number;
      message: string;
    }
  | {
      status: 'approved';
      accessToken: string;
      tokenType: string;
      expiresInSeconds: number;
      idToken?: string;
    }
  | {
      status: 'denied';
      message: string;
    }
  | {
      status: 'expired';
      message: string;
    }
  | {
      status: 'error';
      message: string;
    };

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeDomain(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
}

function normalizeIssuer(rawIssuer: string): string {
  return rawIssuer.replace(/\/+$/g, '') + '/';
}

function resolveCibaConfig(params: { audience?: string; scope?: string }): CibaBaseConfig {
  const domain = normalizeDomain(requireEnv('AUTH0_DOMAIN'));
  const clientId = requireEnv('AUTH0_CLIENT_ID');
  const clientSecret = requireEnv('AUTH0_CLIENT_SECRET');
  const audience =
    params.audience ??
    process.env.AUTH0_CIBA_AUDIENCE?.trim();

  const scope = params.scope ?? process.env.AUTH0_CIBA_SCOPE?.trim() ?? 'openid';
  const issuer = normalizeIssuer(process.env.AUTH0_CIBA_LOGIN_HINT_ISSUER?.trim() ?? `https://${domain}`);

  return {
    domain,
    clientId,
    clientSecret,
    audience,
    scope,
    issuer,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {
      message: text,
    };
  }
}

function parseAuth0Error(payload: Record<string, unknown>, fallback: string): string {
  const description = asString(payload.error_description);
  const error = asString(payload.error);
  const message = asString(payload.message);

  return description ?? message ?? error ?? fallback;
}

function encodeLoginHint(founderUserId: string, issuer: string): string {
  return JSON.stringify({
    format: 'iss_sub',
    iss: issuer,
    sub: founderUserId,
  });
}

export async function initiateCibaAuthorization(input: CibaInitiationInput): Promise<CibaInitiationResult> {
  const config = resolveCibaConfig({ audience: input.audience, scope: input.scope });

  const requestCiba = async (includeAudience: boolean) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope,
      login_hint: encodeLoginHint(input.founderUserId, config.issuer),
      binding_message: input.bindingMessage,
    });

    if (includeAudience && config.audience) {
      params.set('audience', config.audience);
    }

    if (typeof input.requestedExpirySeconds === 'number' && Number.isFinite(input.requestedExpirySeconds)) {
      params.set('requested_expiry', String(Math.max(60, Math.floor(input.requestedExpirySeconds))));
    }

    const response = await fetch(`https://${config.domain}/bc-authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const payload = await parseJson(response);
    return { response, payload };
  };

  const useAudience = Boolean(config.audience);
  let { response, payload } = await requestCiba(useAudience);

  if (!response.ok) {
    const errorMessage = parseAuth0Error(payload, 'Failed to initiate CIBA authorization request.');
    const shouldRetryWithoutAudience = useAudience && /service not found/i.test(errorMessage);

    if (shouldRetryWithoutAudience) {
      const retry = await requestCiba(false);
      response = retry.response;
      payload = retry.payload;
    }
  }

  if (!response.ok) {
    throw new Error(parseAuth0Error(payload, 'Failed to initiate CIBA authorization request.'));
  }

  const authReqId = asString(payload.auth_req_id);
  const expiresInSecondsRaw = Number(payload.expires_in);
  const intervalSecondsRaw = Number(payload.interval);

  if (!authReqId) {
    throw new Error('Auth0 CIBA response did not include auth_req_id.');
  }

  const expiresInSeconds = Number.isFinite(expiresInSecondsRaw) && expiresInSecondsRaw > 0 ? expiresInSecondsRaw : 300;
  const intervalSeconds = Number.isFinite(intervalSecondsRaw) && intervalSecondsRaw > 0 ? intervalSecondsRaw : 5;
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + expiresInSeconds * 1000);

  return {
    authReqId,
    expiresInSeconds,
    intervalSeconds,
    requestedAtISO: requestedAt.toISOString(),
    expiresAtISO: expiresAt.toISOString(),
  };
}

export async function pollCibaAuthorization(params: {
  authReqId: string;
  audience?: string;
  scope?: string;
}): Promise<CibaPollResult> {
  const config = resolveCibaConfig({ audience: params.audience, scope: params.scope });

  const body = new URLSearchParams({
    grant_type: 'urn:openid:params:grant-type:ciba',
    auth_req_id: params.authReqId,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(`https://${config.domain}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const payload = await parseJson(response);

  if (response.ok) {
    const accessToken = asString(payload.access_token);
    const tokenType = asString(payload.token_type) ?? 'Bearer';
    const expiresInSecondsRaw = Number(payload.expires_in);
    const idToken = asString(payload.id_token);

    if (!accessToken) {
      return {
        status: 'error',
        message: 'CIBA token response did not include an access_token.',
      };
    }

    return {
      status: 'approved',
      accessToken,
      tokenType,
      expiresInSeconds:
        Number.isFinite(expiresInSecondsRaw) && expiresInSecondsRaw > 0 ? expiresInSecondsRaw : 300,
      idToken,
    };
  }

  const errorCode = asString(payload.error)?.toLowerCase() ?? '';
  const errorMessage = parseAuth0Error(payload, 'Failed to poll CIBA authorization request.');

  if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
    return {
      status: 'pending',
      pollAfterSeconds: errorCode === 'slow_down' ? 10 : 5,
      message: errorMessage,
    };
  }

  if (errorCode === 'access_denied') {
    return {
      status: 'denied',
      message: errorMessage,
    };
  }

  if (errorCode === 'expired_token') {
    return {
      status: 'expired',
      message: errorMessage,
    };
  }

  // Auth0 may return stale/invalid CIBA request IDs as invalid_grant instead of expired_token.
  if (
    errorCode === 'invalid_grant' &&
    /invalid\s+or\s+expired\s+auth_req_id|expired\s+auth_req_id/i.test(errorMessage)
  ) {
    return {
      status: 'expired',
      message: errorMessage,
    };
  }

  return {
    status: 'error',
    message: errorMessage,
  };
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function decodeJwtSubUnsafe(token: string): string | undefined {
  const segments = token.split('.');
  if (segments.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(segments[1])) as unknown;
    const record = asRecord(payload);
    return asString(record?.sub);
  } catch {
    return undefined;
  }
}
