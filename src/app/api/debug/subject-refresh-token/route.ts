import { NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import { getAuth0SubjectRefreshToken } from '@/lib/auth0-subject-refresh-token';

export async function GET() {
  const session = await auth0.getSession();
  const userId = session?.user?.sub;

  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const token = await getAuth0SubjectRefreshToken(userId).catch(() => null);

  return NextResponse.json({
    ok: true,
    userId,
    hasSessionRefreshToken: Boolean(session?.tokenSet?.refreshToken),
    hasStoredRefreshToken: Boolean(token),
  });
}
