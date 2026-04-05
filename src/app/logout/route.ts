import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const returnTo = `${origin}/login`;
  const logoutUrl = `${origin}/auth/logout?returnTo=${encodeURIComponent(returnTo)}`;

  return NextResponse.redirect(logoutUrl);
}
