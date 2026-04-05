import { NextResponse, type NextRequest } from 'next/server';

import { auth0 } from '@/lib/auth0';
import {
  isOnboardingCookieCompleteForUser,
  ONBOARDING_COOKIE_NAME,
} from '@/lib/onboarding';

const LOGIN_PATH = '/login';
const ONBOARDING_PATH = '/onboarding';
const DASHBOARD_PATH = '/';
const PUBLIC_ROUTES = new Set([
  '/login',
  '/logout',
  '/close',
]);

const isSessionDecryptionError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return error.name === 'JWEDecryptionFailed' || /decryption operation failed/i.test(error.message);
};

const AUTH_COOKIE_PREFIXES = ['appSession', 'a0:', '__session', 'auth0'];
const ONBOARDING_HEALTH_CACHE_TTL_MS = 60_000;

type OnboardingHealthCacheEntry = {
  value: boolean | null;
  expiresAt: number;
};

const onboardingHealthCache = new Map<string, OnboardingHealthCacheEntry>();

const redirectToLogin = (request: NextRequest) =>
  NextResponse.redirect(new URL(LOGIN_PATH, request.url));

const redirectToOnboarding = (request: NextRequest) =>
  NextResponse.redirect(new URL(ONBOARDING_PATH, request.url));

const redirectToDashboard = (request: NextRequest) =>
  NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));

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

const clearOnboardingCookie = (response: NextResponse) => {
  response.cookies.set(ONBOARDING_COOKIE_NAME, '', {
    expires: new Date(0),
    path: '/',
  });

  return response;
};

const readAllRequiredConnected = async (
  request: NextRequest,
  cacheKey: string,
): Promise<boolean | null> => {
  const now = Date.now();
  const cached = onboardingHealthCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const statusUrl = new URL('/api/onboarding/status', request.url);
    const cookieHeader = request.headers.get('cookie');
    const response = await fetch(statusUrl, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: 'no-store',
    });

    if (!response.ok) {
      onboardingHealthCache.set(cacheKey, {
        value: null,
        expiresAt: now + 15_000,
      });
      return null;
    }

    const payload = (await response.json()) as {
      allRequiredConnected?: boolean;
      statusCheckDegraded?: boolean;
    };

    if (payload.statusCheckDegraded === true) {
      onboardingHealthCache.set(cacheKey, {
        value: null,
        expiresAt: now + 15_000,
      });
      return null;
    }

    const nextValue =
      typeof payload.allRequiredConnected === 'boolean' ? payload.allRequiredConnected : null;

    onboardingHealthCache.set(cacheKey, {
      value: nextValue,
      expiresAt: now + ONBOARDING_HEALTH_CACHE_TTL_MS,
    });

    return nextValue;
  } catch {
    onboardingHealthCache.set(cacheKey, {
      value: null,
      expiresAt: now + 15_000,
    });
    return null;
  }
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
      const isAuthLoginRoute = pathname === '/auth/login';
      const isSignupFlow = request.nextUrl.searchParams.get('screen_hint') === 'signup';
      const resetOnboarding = request.nextUrl.searchParams.get('reset_onboarding') === '1';

      // A stale onboarding cookie can survive Auth0 user deletion/recreation
      // when the upstream identity keeps the same subject. Explicit fresh-login
      // flows can request onboarding reset to avoid being incorrectly treated
      // as already onboarded.
      if (isAuthLoginRoute && (isSignupFlow || resetOnboarding)) {
        authRes.cookies.set(ONBOARDING_COOKIE_NAME, '', {
          expires: new Date(0),
          path: '/',
        });
      }

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
    if (!session?.user?.sub) {
      return redirectToLogin(request);
    }

    // Keep authenticated API traffic available while onboarding is in progress.
    if (pathname.startsWith('/api/')) {
      return authRes;
    }

    const isOnboardingRoute = pathname === ONBOARDING_PATH;
    const onboardingComplete = isOnboardingCookieCompleteForUser(
      request.cookies.get(ONBOARDING_COOKIE_NAME)?.value,
      session.user.sub,
    );

    // When onboarding is marked complete, re-verify live integration health.
    // This prevents stale onboarding cookies from bypassing onboarding when
    // diagnostics would classify the account as unhealthy.
    let allRequiredConnected: boolean | null = null;
    if (onboardingComplete) {
      allRequiredConnected = await readAllRequiredConnected(request, session.user.sub);
    }

    if (onboardingComplete && allRequiredConnected === false) {
      return clearOnboardingCookie(redirectToOnboarding(request));
    }

    if (!onboardingComplete && !isOnboardingRoute) {
      return redirectToOnboarding(request);
    }

    if (onboardingComplete && allRequiredConnected !== false && isOnboardingRoute) {
      return redirectToDashboard(request);
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
    * - assets, images (public static files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|images|assets|favicon.[ico|png]|sitemap.xml|robots.txt).*)',
  ],
};
