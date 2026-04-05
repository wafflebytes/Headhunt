import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { TokenVaultError } from '@auth0/ai/interrupts';

export const auth0 = new Auth0Client({
  enableConnectAccountEndpoint: true,
});

const TOKEN_VAULT_SUBJECT_AUDIENCE =
  process.env.AUTH0_TOKEN_VAULT_SUBJECT_AUDIENCE?.trim() ||
  process.env.MCP_AUTH_AUDIENCE?.trim();
const TOKEN_VAULT_SUBJECT_SCOPE = process.env.AUTH0_TOKEN_VAULT_SUBJECT_SCOPE?.trim();

const isJwtLike = (value: string) => value.split('.').length === 3;

// Get the refresh token from Auth0 session
export const getRefreshToken = async () => {
  const session = await auth0.getSession();
  return session?.tokenSet?.refreshToken;
};

// Get an Auth0 access token suitable as the subject token for Token Vault access-token exchange.
export const getSessionAccessToken = async () => {
  const options: { audience?: string; scope?: string } = {};

  if (TOKEN_VAULT_SUBJECT_AUDIENCE) {
    options.audience = TOKEN_VAULT_SUBJECT_AUDIENCE;
  }

  if (TOKEN_VAULT_SUBJECT_SCOPE) {
    options.scope = TOKEN_VAULT_SUBJECT_SCOPE;
  }

  const { token } =
    Object.keys(options).length > 0
      ? await auth0.getAccessToken(options)
      : await auth0.getAccessToken();

  if (!token) {
    return token;
  }

  if (!isJwtLike(token)) {
    throw new TokenVaultError(
      'Token Vault access-token exchange requires a JWT subject token. Configure AUTH0_TOKEN_VAULT_SUBJECT_AUDIENCE (or MCP_AUTH_AUDIENCE) to an API audience that issues JWT access tokens.',
    );
  }

  return token;
};

export const getUser = async () => {
  const session = await auth0.getSession();
  return session?.user;
};
