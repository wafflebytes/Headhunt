import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { executeAutomationHandler } from '@/lib/automation/queue';
import { runSummarizeDriveTranscriptPdf } from '@/lib/tools/interview-transcripts';

export const runtime = 'nodejs';

const requestSchema = z.object({
  candidateId: z.string().min(1),
  slackChannel: z.string().min(1).default('new-channel'),
  driveFolderName: z.string().min(1).default('Headhunt Transcripts'),
  driveQuery: z.string().min(1).optional(),
  maxTranscriptChars: z.number().int().min(2000).max(120000).default(28000),
});

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
  }
  return 'Unknown error';
}

function statusFromFailureMessage(message: string, fallback = 500): number {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return fallback;

  if (normalized.includes('outside a request scope') || normalized.includes('next-dynamic-api-wrong-context')) {
    return 401;
  }

  if (/authorization required to access the token vault/i.test(message)) {
    return 401;
  }

  if (normalized.includes('federated token exchange failed')) {
    return 401;
  }

  if (normalized.includes('no connected account found')) {
    return 401;
  }

  if (normalized.includes('missing refresh token') || normalized.includes('refresh token not found')) {
    return 401;
  }

  if (normalized.includes('forbidden')) {
    return 403;
  }

  if (normalized.includes('slack channel not found')) {
    return 400;
  }

  if (normalized.includes('no drive transcript target provided')) {
    return 400;
  }

  if (normalized.includes('not found') || normalized.includes('no matching transcript pdf found')) {
    return 404;
  }

  return fallback;
}

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof auth0.getSession>> | null = null;
  try {
    session = await auth0.getSession();
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error('[interview-transcripts/digest] getSession failed:', message);
    return NextResponse.json(
      {
        status: 'error',
        check: 'auth_session',
        message,
      },
      { status: statusFromFailureMessage(message, 500) },
    );
  }

  const actorUserId = session?.user?.sub ?? null;

  if (!actorUserId) {
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { status: 'error', message: error instanceof Error ? error.message : 'Invalid request body.' },
      { status: 400 },
    );
  }

  let transcriptResult: unknown;
  try {
    transcriptResult = await runSummarizeDriveTranscriptPdf({
      candidateId: parsed.candidateId,
      actorUserId,
      tokenVaultLoginHint: actorUserId,
      driveFolderName: parsed.driveFolderName,
      driveQuery: parsed.driveQuery,
      maxTranscriptChars: parsed.maxTranscriptChars,
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error('[interview-transcripts/digest] summarize_drive_transcript_pdf failed:', message);
    return NextResponse.json(
      {
        status: 'error',
        check: 'summarize_drive_transcript_pdf',
        message,
      },
      { status: statusFromFailureMessage(message, 500) },
    );
  }

  const transcriptRecord: Record<string, unknown> | null =
    transcriptResult && typeof transcriptResult === 'object' ? (transcriptResult as Record<string, unknown>) : null;
  const transcriptStatus = typeof transcriptRecord?.status === 'string' ? transcriptRecord.status : null;
  const transcriptMessage = typeof transcriptRecord?.message === 'string' ? transcriptRecord.message : null;
  const transcriptCheck = typeof transcriptRecord?.check === 'string' ? transcriptRecord.check : null;

  if (!transcriptRecord || transcriptStatus !== 'success') {
    const message = transcriptMessage ?? 'Unable to summarize Drive transcript PDF.';
    return NextResponse.json(
      {
        status: 'error',
        check: transcriptCheck ?? 'summarize_drive_transcript_pdf',
        message,
        transcript: transcriptResult ?? null,
      },
      { status: statusFromFailureMessage(message, 500) },
    );
  }

  const summary = transcriptRecord?.summary;
  const jobId = typeof transcriptRecord?.jobId === 'string' ? transcriptRecord.jobId : undefined;

  let digestResult: unknown;
  try {
    digestResult = await executeAutomationHandler({
      handlerType: 'interview.transcript.debrief.slack',
      payload: {
        actorUserId,
        candidateId: parsed.candidateId,
        ...(jobId ? { jobId } : {}),
        source: 'drive_pdf',
        slackChannel: parsed.slackChannel,
        summary,
        transcriptResult,
      },
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error('[interview-transcripts/digest] interview_transcript_slack_digest failed:', message);
    return NextResponse.json(
      {
        status: 'error',
        check: 'interview_transcript_slack_digest',
        message,
      },
      { status: statusFromFailureMessage(message, 500) },
    );
  }

  if (!digestResult || typeof digestResult !== 'object') {
    return NextResponse.json(
      { status: 'error', check: 'interview_transcript_slack_digest', message: 'Slack digest failed.' },
      { status: 500 },
    );
  }

  if ((digestResult as any).status !== 'success') {
    const message = String((digestResult as any).message ?? 'Slack digest failed.');
    return NextResponse.json(
      {
        status: 'error',
        check: (digestResult as any).check ?? 'interview_transcript_slack_digest',
        message,
        digest: digestResult,
      },
      { status: statusFromFailureMessage(message, 500) },
    );
  }

  return NextResponse.json({
    status: 'success',
    transcript: transcriptResult,
    digest: digestResult,
  });
}
