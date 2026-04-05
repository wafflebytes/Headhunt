import { NextRequest, NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import {
  ONBOARDING_COOKIE_NAME,
  serializeOnboardingCookieValue,
} from '@/lib/onboarding';
import {
  areAllRequiredIntegrationsConnected,
  getOnboardingIntegrationStatuses,
} from '@/lib/onboarding-status';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const statuses = await getOnboardingIntegrationStatuses(request.nextUrl.origin);

    if (!areAllRequiredIntegrationsConnected(statuses)) {
      return NextResponse.json(
        {
          message: 'Please connect Google, Cal.com, and Slack before entering the dashboard.',
          allRequiredConnected: false,
          integrations: statuses,
        },
        { status: 409 },
      );
    }

    const response = NextResponse.json({
      success: true,
      allRequiredConnected: true,
      integrations: statuses,
    });

    response.cookies.set(ONBOARDING_COOKIE_NAME, serializeOnboardingCookieValue(session.user.sub), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to complete onboarding.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
