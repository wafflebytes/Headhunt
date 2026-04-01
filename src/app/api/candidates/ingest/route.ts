import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { CandidateIngestAccessError, ingestCandidateFromEmail } from '@/lib/actions/candidates-ingest';
import { auth0 } from '@/lib/auth0';

const ingestCandidateSchema = z.object({
  jobId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  candidateName: z.string().min(1),
  candidateEmail: z.string().email(),
  rawEmailText: z.string().min(1),
  source: z.object({
    gmailMessageId: z.string().min(1),
    gmailThreadId: z.string().min(1).optional(),
    receivedAt: z.string().datetime().optional(),
  }),
});

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();

  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const parsed = ingestCandidateSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'Invalid ingest payload.',
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { jobId, organizationId, candidateName, candidateEmail, rawEmailText, source } = parsed.data;
  const actorId = session.user.sub;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized: missing user identity.' }, { status: 401 });
  }

  const actorDisplayName = session.user.name ?? session.user.email ?? actorId;

  try {
    const result = await ingestCandidateFromEmail({
      jobId,
      organizationId,
      candidateName,
      candidateEmail,
      rawEmailText,
      source,
      actorId,
      actorDisplayName,
      enforceVisibility: true,
    });

    return NextResponse.json({
      message: result.idempotent ? 'Candidate already ingested for this source message.' : 'Candidate ingested.',
      ...result,
    });
  } catch (error) {
    if (error instanceof CandidateIngestAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    console.error('Candidate ingest failed', error);
    return NextResponse.json({ message: 'Failed to ingest candidate.' }, { status: 500 });
  }
}
