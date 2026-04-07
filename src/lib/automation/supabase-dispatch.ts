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

type DispatchParams = {
  functionName: string;
  body?: Record<string, unknown>;
  executeCookie?: string;
};

function resolveFunctionsAuthMode(): 'secret-header' | 'bearer' | 'both' {
  const raw = process.env.SUPABASE_FUNCTIONS_AUTH_MODE?.trim().toLowerCase();

  if (raw === 'bearer' || raw === 'both' || raw === 'secret-header') {
    return raw;
  }

  return 'secret-header';
}

export async function dispatchSupabaseAutomationFunction(params: DispatchParams) {
  const functionsBaseUrl = deriveFunctionsBaseUrl();
  const functionSecret =
    process.env.SUPABASE_AUTOMATION_FUNCTION_SECRET?.trim() ||
    process.env.AUTOMATION_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();

  if (!functionsBaseUrl || !functionSecret) {
    return {
      ok: false,
      status: 500,
      data: {
        message:
          'Supabase automation function dispatch is not configured. Set SUPABASE_FUNCTIONS_URL and one of SUPABASE_AUTOMATION_FUNCTION_SECRET, AUTOMATION_CRON_SECRET, or CRON_SECRET.',
      },
    };
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-automation-secret': functionSecret,
  };

  const authMode = resolveFunctionsAuthMode();
  if (authMode === 'bearer' || authMode === 'both') {
    headers.authorization = `Bearer ${functionSecret}`;
  }

  if (params.executeCookie?.trim()) {
    headers['x-automation-execute-cookie'] = params.executeCookie.trim();
  }

  try {
    const response = await fetch(`${functionsBaseUrl}/${params.functionName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params.body ?? {}),
    });

    const parsed = await parseResponse(response);
    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: {
        message: error instanceof Error ? error.message : 'Failed to call Supabase automation function.',
      },
    };
  }
}

export async function proxyToSupabaseAutomationFunction(params: {
  request: NextRequest;
  functionName: string;
  fallbackBody?: Record<string, unknown>;
}) {
  const payload = await parseRequestBody(params.request);
  const body = {
    ...(params.fallbackBody ?? {}),
    ...payload,
  };
  const executeCookie =
    params.request.headers.get('x-automation-execute-cookie')?.trim() ||
    params.request.headers.get('cookie')?.trim() ||
    '';

  const dispatched = await dispatchSupabaseAutomationFunction({
    functionName: params.functionName,
    body,
    executeCookie,
  });

  return NextResponse.json(dispatched.data, { status: dispatched.status });
}
