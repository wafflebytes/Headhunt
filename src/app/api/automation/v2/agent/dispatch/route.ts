import { NextRequest, NextResponse } from 'next/server';

import { proxyToSupabaseAutomationFunction } from '@/lib/automation/supabase-dispatch';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest) {
  const configuredSecret =
    process.env.AUTOMATION_V2_AGENT_SECRET?.trim() ||
    process.env.SUPABASE_AUTOMATION_FUNCTION_SECRET?.trim() ||
    process.env.AUTOMATION_CRON_SECRET?.trim();
  if (!configuredSecret) {
    return false;
  }

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-automation-secret')?.trim();

  return bearer === configuredSecret || headerSecret === configuredSecret;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  return proxyToSupabaseAutomationFunction({
    request,
    functionName: 'v2-agent-dispatch',
  });
}
