import { NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';

const CONNECTED_ACCOUNTS_AUDIENCE = `https://${process.env.AUTH0_DOMAIN}/me/`;
const CONNECTED_ACCOUNTS_BASE_URL = `https://${process.env.AUTH0_DOMAIN}/me/v1/connected-accounts`;

async function fetchMyAccount(path: string, token: string) {
  const response = await fetch(`${CONNECTED_ACCOUNTS_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text body when response is not JSON.
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { token } = await auth0.getAccessToken({
      audience: CONNECTED_ACCOUNTS_AUDIENCE,
      scope: 'read:me:connected_accounts',
    });

    if (!token) {
      return NextResponse.json({ message: 'Failed to obtain My Account access token.' }, { status: 500 });
    }

    const [accounts, connections] = await Promise.all([
      fetchMyAccount('/accounts', token),
      fetchMyAccount('/connections', token),
    ]);

    return NextResponse.json({
      user: {
        sub: session.user.sub ?? null,
        email: session.user.email ?? null,
      },
      audience: CONNECTED_ACCOUNTS_AUDIENCE,
      accounts,
      connections,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'My Account debug request failed.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
