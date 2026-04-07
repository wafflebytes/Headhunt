import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { processAutomationQueue } from '@/lib/automation/queue';

export const runtime = 'nodejs';

const requestSchema = z
  .object({
    mode: z.enum(['scheduling', 'all']).default('scheduling'),
    limit: z.number().int().min(1).max(10).default(6),
    passes: z.number().int().min(1).max(3).default(2),
  })
  .default({});

function isLikelySameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    return false;
  }

  const xrw = request.headers.get('x-requested-with');
  if (xrw !== 'XMLHttpRequest') {
    return false;
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  const actorUserId = session?.user?.sub ?? null;

  if (!actorUserId) {
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
  }

  if (!isLikelySameOrigin(request)) {
    return NextResponse.json({ status: 'error', message: 'Forbidden' }, { status: 403 });
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Invalid tick request.',
      },
      { status: 400 },
    );
  }

  const handlerTypes =
    parsed.mode === 'all'
      ? undefined
      : (['intake.scan', 'scheduling.reply.parse_book_google', 'scheduling.reply.parse_book'] as const);

  const startedAt = Date.now();
  const passes: Array<Awaited<ReturnType<typeof processAutomationQueue>>> = [];

  for (let pass = 0; pass < parsed.passes; pass += 1) {
    const result = await processAutomationQueue({
      limit: parsed.limit,
      handlerTypes: handlerTypes ? Array.from(handlerTypes) : undefined,
    });

    passes.push(result);

    if (result.claimed === 0) {
      break;
    }
  }

  return NextResponse.json({
    status: 'success',
    mode: parsed.mode,
    limit: parsed.limit,
    passes,
    elapsedMs: Date.now() - startedAt,
    serverTime: new Date().toISOString(),
  });
}
