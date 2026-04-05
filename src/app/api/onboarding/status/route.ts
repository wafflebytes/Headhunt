import { NextRequest, NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import { ONBOARDING_COOKIE_NAME, isOnboardingCookieCompleteForUser } from '@/lib/onboarding';
import {
  areAllRequiredIntegrationsConnected,
  getOnboardingIntegrationStatusSnapshot,
} from '@/lib/onboarding-status';

const STATUS_CACHE_TTL_MS = 15_000;

type CachedOnboardingStatus = {
  expiresAt: number;
  allRequiredConnected: boolean;
  statusCheckDegraded: boolean;
  integrations: Awaited<ReturnType<typeof getOnboardingIntegrationStatusSnapshot>>['statuses'];
};

const onboardingStatusCache = new Map<string, CachedOnboardingStatus>();

export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const cacheKey = session.user.sub;
  const now = Date.now();
  const cached = onboardingStatusCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return NextResponse.json({
      onboardingComplete: isOnboardingCookieCompleteForUser(
        request.cookies.get(ONBOARDING_COOKIE_NAME)?.value,
        session.user.sub,
      ),
      allRequiredConnected: cached.allRequiredConnected,
      statusCheckDegraded: cached.statusCheckDegraded,
      integrations: cached.integrations,
      cached: true,
    });
  }

  try {
    const statusSnapshot = await getOnboardingIntegrationStatusSnapshot(request.nextUrl.origin);
    const statuses = statusSnapshot.statuses;
    const allRequiredConnected = areAllRequiredIntegrationsConnected(statuses);

    onboardingStatusCache.set(cacheKey, {
      expiresAt: now + STATUS_CACHE_TTL_MS,
      allRequiredConnected,
      statusCheckDegraded: statusSnapshot.degraded,
      integrations: statuses,
    });

    return NextResponse.json({
      onboardingComplete: isOnboardingCookieCompleteForUser(
        request.cookies.get(ONBOARDING_COOKIE_NAME)?.value,
        session.user.sub,
      ),
      allRequiredConnected,
      statusCheckDegraded: statusSnapshot.degraded,
      integrations: statuses,
      cached: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load onboarding connection status.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
