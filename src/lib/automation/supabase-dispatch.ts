import { NextRequest, NextResponse } from 'next/server';

function deriveFunctionsBaseUrl(): string | null {
  const explicit = process.env.SUPABASE_FUNCTIONS_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(supabaseUrl);
    if (!parsed.hostname.endsWith('.supabase.co')) {
      return null;
    }

    const projectRef = parsed.hostname.replace('.supabase.co', '');
    return `https://${projectRef}.functions.supabase.co`;
  } catch {
    return null;
  }
}

async function parseRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return {};
  } catch {
    return {};
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function proxyToSupabaseAutomationFunction(params: {
  request: NextRequest;
  functionName: string;
  fallbackBody?: Record<string, unknown>;
}) {
  const functionsBaseUrl = deriveFunctionsBaseUrl();
  const functionSecret =
    process.env.SUPABASE_AUTOMATION_FUNCTION_SECRET?.trim() || process.env.AUTOMATION_CRON_SECRET?.trim();

  if (!functionsBaseUrl || !functionSecret) {
    return NextResponse.json(
      {
        message:
          'Supabase automation function dispatch is not configured. Set SUPABASE_FUNCTIONS_URL and SUPABASE_AUTOMATION_FUNCTION_SECRET.',
      },
      { status: 500 },
    );
  }

  const payload = await parseRequestBody(params.request);
  const body = Object.keys(payload).length > 0 ? payload : params.fallbackBody ?? {};

  try {
    const response = await fetch(`${functionsBaseUrl}/${params.functionName}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${functionSecret}`,
        'x-automation-secret': functionSecret,
      },
      body: JSON.stringify(body),
    });

    const parsed = await parseResponse(response);
    return NextResponse.json(parsed, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to call Supabase automation function.',
      },
      { status: 502 },
    );
  }
}
