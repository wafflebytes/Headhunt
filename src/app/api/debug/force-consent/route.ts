import { NextRequest, NextResponse } from 'next/server';

function normalizeReturnTo(raw: string | null) {
  if (!raw) {
    return '/';
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return '/';
  }

  // Prevent open redirects: allow only same-origin relative paths.
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/';
  }

  return trimmed;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));

  const scope = (process.env.AUTH0_SCOPE?.trim() || 'openid profile email offline_access').trim();

  const loginUrl = new URL('/auth/login', url.origin);
  loginUrl.searchParams.set('returnTo', returnTo);
  loginUrl.searchParams.set('prompt', 'consent');
  loginUrl.searchParams.set('max_age', '0');
  loginUrl.searchParams.set('scope', scope);

  return NextResponse.redirect(loginUrl);
}
