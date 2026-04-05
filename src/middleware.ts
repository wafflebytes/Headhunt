import { NextResponse, type NextRequest } from 'next/server';

import { auth0 } from '@/lib/auth0';

const LOGIN_PATH = '/login';
const PUBLIC_ROUTES = new Set([
  '/login',
  '/logout',
  '/onboarding',
  '/assistant',
  '/invoices',
  '/pipeline',
  '/clients',
  '/agents',
  '/mcp',
  '/security',
]);

const isSessionDecryptionError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return error.name === 'JWEDecryptionFailed' || /decryption operation failed/i.test(error.message);
};

const AUTH_COOKIE_PREFIXES = ['appSession', 'a0:', '__session', 'auth0'];

const redirectToLogin = (request: NextRequest) =>
  NextResponse.redirect(new URL(LOGIN_PATH, request.url));

const clearPotentialAuthCookies = (response: NextResponse, request: NextRequest) => {
  for (const cookie of request.cookies.getAll()) {
    if (AUTH_COOKIE_PREFIXES.some((prefix) => cookie.name.startsWith(prefix))) {
      response.cookies.set(cookie.name, '', {
        expires: new Date(0),
        path: '/',
      });
    }
  }

  return response;
};

/**
 * Middleware to handle authentication using Auth0
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  try {
    const authRes = await auth0.middleware(request);

    // Authentication routes are handled by Auth0 middleware.
    if (pathname.startsWith('/auth')) {
      return authRes;
    }

    // Secret-protected automation APIs must be reachable by Supabase workers
    // that do not carry an Auth0 browser session cookie.
    if (pathname.startsWith('/api/automation/')) {
      return authRes;
    }

    // Public entry routes for the NET.30 shell flow.
    if (PUBLIC_ROUTES.has(pathname)) {
      return authRes;
    }

    const session = await auth0.getSession(request);

    // user does not have a session — redirect to login page
    if (!session) {
      return redirectToLogin(request);
    }

    return authRes;
  } catch (error) {
    // Recover from stale/corrupted encrypted Auth0 session cookies.
    if (isSessionDecryptionError(error)) {
      return clearPotentialAuthCookies(redirectToLogin(request), request);
    }

    throw error;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|images|favicon.[ico|png]|sitemap.xml|robots.txt).*)',
  ],
};
