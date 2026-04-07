import { NextRequest, NextResponse } from 'next/server';
import { dispatchSupabaseAutomationFunction } from '@/lib/automation/supabase-dispatch';

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.AUTOMATION_WEBHOOK_SECRET?.trim() || process.env.AUTOMATION_CRON_SECRET?.trim();
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

  const raw = await request.text();
  const payload = (() => {
    if (!raw.trim()) {
      return {} as Record<string, unknown>;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {} as Record<string, unknown>;
    }

    return {} as Record<string, unknown>;
  })();

  const table = typeof payload.table === 'string' ? payload.table : null;
  const functionName =
    table === 'offers'
      ? 'v2-webhook-offer-status'
      : table === 'candidates'
        ? 'v2-webhook-candidate-created'
        : null;

  if (!functionName) {
    return NextResponse.json(
      {
        check: 'automation_webhook_proxy',
        status: 'ignored',
        reason: 'Unsupported webhook table for v2 routing.',
        table,
      },
      { status: 200 },
    );
  }

  const executeCookie =
    request.headers.get('x-automation-execute-cookie')?.trim() || request.headers.get('cookie')?.trim() || '';
  const dispatched = await dispatchSupabaseAutomationFunction({
    functionName,
    body: payload,
    executeCookie,
  });

  return NextResponse.json(dispatched.data, { status: dispatched.status });
}
