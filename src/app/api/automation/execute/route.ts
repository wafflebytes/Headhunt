import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { executeAutomationHandler } from '@/lib/automation/queue';

const inputSchema = z.object({
  handlerType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.AUTOMATION_EXECUTE_SECRET?.trim() || process.env.AUTOMATION_CRON_SECRET?.trim();
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

  const payload = inputSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        check: 'automation_execute',
        status: 'error',
        message: payload.error.issues[0]?.message ?? 'Invalid execute payload.',
      },
      { status: 400 },
    );
  }

  const result = await executeAutomationHandler({
    handlerType: payload.data.handlerType,
    payload: payload.data.payload,
  });

  return NextResponse.json({
    check: 'automation_execute',
    status: 'success',
    handlerType: payload.data.handlerType,
    result,
  });
}
