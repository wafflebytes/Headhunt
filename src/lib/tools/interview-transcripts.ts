import { and, desc, eq } from 'drizzle-orm';
import { generateObject, tool } from 'ai';
import { google } from 'googleapis';
import pdf from 'pdf-parse';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import {
  CAL_BOOKINGS_API_VERSION,
  CAL_COM_API_BASE_URL,
  getAccessToken,
  getGoogleAccessToken,
  withCal,
  withDrive,
} from '@/lib/auth0-ai';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';
import { nim, nimChatModelId } from '@/lib/nim';

const transcriptRubricItemSchema = z.object({
  criterion: z.enum([
    'Role Competence',
    'Communication',
    'Problem Solving',
    'Ownership and Drive',
    'Collaboration',
    'Logistics and Motivation',
  ]),
  score: z.number().int().min(1).max(5),
  evidence: z.string().min(1),
  hrInterpretation: z.string().min(1),
});

const transcriptSummarySchema = z.object({
  executiveSummary: z.string().min(1),
  recommendation: z.enum(['Strong Hire', 'Hire', 'Leaning Hire', 'Leaning No-Hire', 'No-Hire']),
  recommendationRationale: z.string().min(1),
  overallRubricScore: z.number().int().min(6).max(30),
  rubric: z.array(transcriptRubricItemSchema).length(6),
  candidateStrengths: z.array(z.string().min(1)).min(2).max(8),
  candidateRisks: z.array(z.string().min(1)).min(1).max(8),
  actionableFollowUps: z.array(z.string().min(1)).min(3).max(10),
  interviewerActionItems: z.array(z.string().min(1)).min(3).max(10),
  quotedEvidence: z
    .array(
      z.object({
        quote: z.string().min(1),
        whyItMatters: z.string().min(1),
      }),
    )
    .min(2)
    .max(8),
  nextRoundFocus: z.array(z.string().min(1)).min(3).max(10),
});

const summarizeCalBookingTranscriptInputSchema = z.object({
  bookingUid: z.string().min(1),
  candidateId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  maxTranscriptChars: z.number().int().min(2000).max(120000).default(22000),
});

const summarizeDriveTranscriptPdfInputSchema = z
  .object({
    driveFileId: z.string().min(1).optional(),
    driveQuery: z.string().min(1).optional(),
    driveFolderId: z.string().min(1).optional(),
    driveFolderName: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    organizationId: z.string().optional(),
    actorUserId: z.string().min(1).optional(),
    maxTranscriptChars: z.number().int().min(2000).max(120000).default(22000),
  });

type CandidateContext = {
  id: string;
  name: string;
  contactEmail: string;
  organizationId: string | null;
  jobId: string;
};

type JobContext = {
  id: string;
  title: string;
};

type InterviewContext = {
  id: string;
  organizationId: string | null;
  candidateId: string;
  jobId: string;
  googleCalendarEventId: string | null;
};

type ResolvedContext = {
  actorUserId: string;
  candidate: CandidateContext | null;
  job: JobContext | null;
  interview: InterviewContext | null;
  organizationId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return compactWhitespace(value.replace(/<[^>]+>/g, ' '));
}

function stripWebVtt(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.toUpperCase() !== 'WEBVTT')
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^(\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}\.\d{3}/.test(line));

  return compactWhitespace(lines.join(' '));
}

function truncateForModel(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[Transcript truncated to ${maxChars} characters]`;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const normalized = values
    .map((value) => asString(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(normalized));
}

async function resolveDriveFolderId(params: {
  drive: ReturnType<typeof google.drive>;
  auth: InstanceType<typeof google.auth.OAuth2>;
  explicitFolderId?: string;
  explicitFolderName?: string;
}): Promise<{ folderId: string | null; folderName: string | null }> {
  const explicitFolderId = asString(params.explicitFolderId);
  if (explicitFolderId) {
    return {
      folderId: explicitFolderId,
      folderName: asString(params.explicitFolderName),
    };
  }

  const candidateFolderNames = uniqueNonEmpty([
    params.explicitFolderName,
    process.env.HEADHUNT_TRANSCRIPTS_DRIVE_FOLDER_NAME,
    process.env.HEADHUNT_TRANSCRIPT_DRIVE_FOLDER_NAME,
    'Headhunt Transcripts',
  ]);

  for (const folderName of candidateFolderNames) {
    const escapedFolderName = escapeDriveQueryValue(folderName);
    const folderQuery =
      `trashed = false and mimeType = 'application/vnd.google-apps.folder' and ` +
      `name = '${escapedFolderName}'`;

    const listed = await params.drive.files.list({
      auth: params.auth,
      q: folderQuery,
      pageSize: 3,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const picked = listed.data.files?.[0];
    if (picked?.id) {
      return {
        folderId: picked.id,
        folderName: picked.name ?? folderName,
      };
    }
  }

  return {
    folderId: null,
    folderName: asString(params.explicitFolderName),
  };
}

function extractTextFromJsonPayload(value: unknown): string {
  const snippets: string[] = [];

  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || snippets.length > 2500) {
      return;
    }

    if (typeof node === 'string') {
      const compacted = compactWhitespace(node);
      if (compacted.length > 0) {
        snippets.push(compacted);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, depth + 1));
      return;
    }

    const record = asRecord(node);
    if (!record) {
      return;
    }

    const priorityKeys = ['transcript', 'text', 'content', 'caption', 'captions', 'utterance', 'message', 'data'];
    for (const key of priorityKeys) {
      if (key in record) {
        visit(record[key], depth + 1);
      }
    }

    Object.values(record).forEach((child) => visit(child, depth + 1));
  };

  visit(value, 0);
  return compactWhitespace(snippets.join(' '));
}

async function extractTranscriptTextFromResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('application/pdf')) {
    const arrayBuffer = await response.arrayBuffer();
    const parsed = await pdf(Buffer.from(arrayBuffer));
    return compactWhitespace(parsed.text || '');
  }

  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as unknown;
    return extractTextFromJsonPayload(payload);
  }

  const text = await response.text();
  if (contentType.includes('text/html')) {
    return stripHtml(text);
  }

  if (contentType.includes('text/vtt') || text.toUpperCase().includes('WEBVTT')) {
    return stripWebVtt(text);
  }

  return compactWhitespace(text);
}

async function fetchTranscriptTextFromUrl(url: string, calAccessToken: string): Promise<string> {
  const attempts: Array<Record<string, string>> = [
    {},
    { Authorization: `Bearer ${calAccessToken}` },
  ];

  for (const headers of attempts) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      continue;
    }

    const parsed = await extractTranscriptTextFromResponse(response);
    if (parsed) {
      return parsed;
    }
  }

  return '';
}

async function resolveContext(params: {
  actorUserId?: string;
  organizationId?: string;
  candidateId?: string;
  jobId?: string;
  bookingUid?: string;
}): Promise<
  | { ok: true; value: ResolvedContext }
  | { ok: false; error: { check: string; status: 'error'; message: string } }
> {
  const actorUserId = params.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;
  if (!actorUserId) {
    return {
      ok: false,
      error: {
        check: 'transcript_summary',
        status: 'error',
        message: 'Unauthorized: missing actor identity.',
      },
    };
  }

  let interview: InterviewContext | null = null;
  if (params.bookingUid) {
    const [foundInterview] = await db
      .select({
        id: interviews.id,
        organizationId: interviews.organizationId,
        candidateId: interviews.candidateId,
        jobId: interviews.jobId,
        googleCalendarEventId: interviews.googleCalendarEventId,
      })
      .from(interviews)
      .where(eq(interviews.googleCalendarEventId, `cal:${params.bookingUid}`))
      .orderBy(desc(interviews.createdAt))
      .limit(1);

    interview = foundInterview ?? null;
  }

  const effectiveCandidateId = params.candidateId ?? interview?.candidateId ?? null;
  let candidate: CandidateContext | null = null;

  if (effectiveCandidateId) {
    const [foundCandidate] = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        contactEmail: candidates.contactEmail,
        organizationId: candidates.organizationId,
        jobId: candidates.jobId,
      })
      .from(candidates)
      .where(eq(candidates.id, effectiveCandidateId))
      .limit(1);

    if (!foundCandidate) {
      return {
        ok: false,
        error: {
          check: 'transcript_summary',
          status: 'error',
          message: `Candidate ${effectiveCandidateId} not found.`,
        },
      };
    }

    const canView = await canViewCandidate(actorUserId, foundCandidate.id);
    if (!canView) {
      return {
        ok: false,
        error: {
          check: 'transcript_summary',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${foundCandidate.id}.`,
        },
      };
    }

    candidate = foundCandidate;
  }

  const effectiveJobId = params.jobId ?? interview?.jobId ?? candidate?.jobId ?? null;
  let job: JobContext | null = null;

  if (effectiveJobId) {
    const [foundJob] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
      })
      .from(jobs)
      .where(eq(jobs.id, effectiveJobId))
      .limit(1);

    if (!foundJob) {
      return {
        ok: false,
        error: {
          check: 'transcript_summary',
          status: 'error',
          message: `Job ${effectiveJobId} not found.`,
        },
      };
    }

    job = foundJob;
  }

  const organizationId =
    params.organizationId ?? interview?.organizationId ?? candidate?.organizationId ?? null;

  return {
    ok: true,
    value: {
      actorUserId,
      candidate,
      job,
      interview,
      organizationId,
    },
  };
}

async function generateTranscriptSummary(params: {
  sourceText: string;
  maxChars: number;
  candidateName?: string | null;
  jobTitle?: string | null;
}): Promise<z.infer<typeof transcriptSummarySchema>> {
  const transcript = truncateForModel(params.sourceText, params.maxChars);
  const roleContext = [
    params.candidateName ? `Candidate: ${params.candidateName}` : null,
    params.jobTitle ? `Role: ${params.jobTitle}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const prompt = [
    'You are a senior recruiting operations lead.',
    'Summarize this interview transcript into a practical hiring debrief for recruiters and hiring managers.',
    'Requirements:',
    '- Ground every point in transcript evidence. Do not invent facts.',
    '- Keep an HR lens: interview quality, candidate signals, risks, and concrete next actions.',
    '- Fill the 6-point rubric with scores 1-5 and short evidence-backed interpretation.',
    '- Compute overallRubricScore as the sum of rubric scores (6-30).',
    '- quotedEvidence must include direct short quotes or close paraphrases from transcript text.',
    '- actionableFollowUps and interviewerActionItems should be specific and executable.',
    roleContext || 'Candidate and role context may be unknown.',
    `Transcript:\n${transcript}`,
  ].join('\n\n');

  const { object } = await generateObject({
    model: nim.chatModel(nimChatModelId),
    schema: transcriptSummarySchema,
    temperature: 0.1,
    prompt,
  });

  return object;
}

async function persistTranscriptSummary(params: {
  context: ResolvedContext;
  summary: z.infer<typeof transcriptSummarySchema>;
  action: string;
  sourceType: 'cal_transcript' | 'drive_pdf';
  sourceId: string;
  metadata: Record<string, unknown>;
}) {
  const { context } = params;
  const now = new Date();

  await db.transaction(async (tx: typeof db) => {
    if (context.interview?.id) {
      await tx
        .update(interviews)
        .set({
          summary: params.summary.executiveSummary,
          updatedAt: now,
        })
        .where(eq(interviews.id, context.interview.id));
    }

    await tx.insert(auditLogs).values({
      organizationId: context.organizationId,
      actorType: 'agent',
      actorId: params.action,
      actorDisplayName: 'Liaison Agent',
      action: 'interview.transcript.summary.generated',
      resourceType: context.candidate?.id ? 'candidate' : 'interview',
      resourceId: context.candidate?.id ?? context.interview?.id ?? params.sourceId,
      metadata: {
        actorUserId: context.actorUserId,
        candidateId: context.candidate?.id ?? null,
        jobId: context.job?.id ?? null,
        interviewId: context.interview?.id ?? null,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        recommendation: params.summary.recommendation,
        overallRubricScore: params.summary.overallRubricScore,
        ...params.metadata,
      },
      result: 'success',
    });
  });
}

export const summarizeCalBookingTranscriptTool = withCal(
  tool({
    description:
      'Fetch transcript URLs for a Cal booking UID via /v2/bookings/{bookingUid}/transcripts, pull transcript text, and generate an HR-style rubric summary.',
    inputSchema: summarizeCalBookingTranscriptInputSchema,
    execute: async (input) => {
      const contextResult = await resolveContext({
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        candidateId: input.candidateId,
        jobId: input.jobId,
        bookingUid: input.bookingUid,
      });

      if (!contextResult.ok) {
        return {
          ...contextResult.error,
          check: 'summarize_cal_booking_transcript',
        };
      }

      const context = contextResult.value;

      try {
        const calAccessToken = await getAccessToken();
        const transcriptsUrl = new URL(`/v2/bookings/${encodeURIComponent(input.bookingUid)}/transcripts`, CAL_COM_API_BASE_URL);

        const transcriptsResponse = await fetch(transcriptsUrl.toString(), {
          headers: {
            Authorization: `Bearer ${calAccessToken}`,
            'cal-api-version': CAL_BOOKINGS_API_VERSION,
          },
        });

        if (!transcriptsResponse.ok) {
          const details = await transcriptsResponse.text();
          return {
            check: 'summarize_cal_booking_transcript',
            status: 'error',
            message: `Failed to fetch Cal transcripts (${transcriptsResponse.status}): ${details}`,
          };
        }

        const payload = (await transcriptsResponse.json()) as unknown;
        const root = asRecord(payload);
        const transcriptUrlsRaw = Array.isArray(root?.data) ? root?.data : [];
        const transcriptUrls = transcriptUrlsRaw
          .map((value) => asString(value))
          .filter((value): value is string => Boolean(value));

        if (transcriptUrls.length === 0) {
          return {
            check: 'summarize_cal_booking_transcript',
            status: 'error',
            message: 'No transcript URLs returned for this booking UID.',
            bookingUid: input.bookingUid,
            fallback: {
              recommended: true,
              nextTool: 'summarize_drive_transcript_pdf',
              reason: 'Provide driveFileId, driveQuery, driveFolderId, or driveFolderName for PDF transcript fallback.',
            },
          };
        }

        const extractedChunks: Array<{ url: string; text: string }> = [];
        for (const url of transcriptUrls.slice(0, 6)) {
          const text = await fetchTranscriptTextFromUrl(url, calAccessToken);
          if (text) {
            extractedChunks.push({ url, text });
          }
        }

        const combinedTranscript = compactWhitespace(extractedChunks.map((chunk) => chunk.text).join(' '));

        if (!combinedTranscript) {
          return {
            check: 'summarize_cal_booking_transcript',
            status: 'error',
            message:
              'Cal transcript URLs were found, but transcript text could not be extracted. Use summarize_drive_transcript_pdf as fallback if a PDF transcript exists in Drive.',
            bookingUid: input.bookingUid,
            transcriptUrls,
            fallback: {
              recommended: true,
              nextTool: 'summarize_drive_transcript_pdf',
              reason: 'Unable to parse text from Cal transcript URLs. Use driveFileId, driveQuery, driveFolderId, or driveFolderName.',
            },
          };
        }

        const summary = await generateTranscriptSummary({
          sourceText: combinedTranscript,
          maxChars: input.maxTranscriptChars,
          candidateName: context.candidate?.name ?? null,
          jobTitle: context.job?.title ?? null,
        });

        await persistTranscriptSummary({
          context,
          summary,
          action: 'summarize_cal_booking_transcript',
          sourceType: 'cal_transcript',
          sourceId: input.bookingUid,
          metadata: {
            bookingUid: input.bookingUid,
            transcriptUrlCount: transcriptUrls.length,
            extractedTranscriptCount: extractedChunks.length,
            transcriptLength: combinedTranscript.length,
          },
        });

        return {
          check: 'summarize_cal_booking_transcript',
          status: 'success',
          source: 'cal_transcript',
          bookingUid: input.bookingUid,
          candidateId: context.candidate?.id ?? null,
          jobId: context.job?.id ?? null,
          interviewId: context.interview?.id ?? null,
          transcriptUrls,
          transcriptStats: {
            transcriptUrlCount: transcriptUrls.length,
            extractedTranscriptCount: extractedChunks.length,
            transcriptLength: combinedTranscript.length,
          },
          summary,
        };
      } catch (error) {
        return {
          check: 'summarize_cal_booking_transcript',
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unknown error while summarizing Cal booking transcripts.',
        };
      }
    },
  }),
);

export const summarizeDriveTranscriptPdfTool = withDrive(
  tool({
    description:
      'Fallback transcript summarization: fetch a transcript PDF from Google Drive (by file ID or search query) and generate an HR-style rubric summary.',
    inputSchema: summarizeDriveTranscriptPdfInputSchema,
    execute: async (input) => {
      const contextResult = await resolveContext({
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        candidateId: input.candidateId,
        jobId: input.jobId,
      });

      if (!contextResult.ok) {
        return {
          ...contextResult.error,
          check: 'summarize_drive_transcript_pdf',
        };
      }

      const context = contextResult.value;

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const drive = google.drive('v3');
        let fileId = input.driveFileId ?? null;
        let fileName: string | null = null;
        let webViewLink: string | null = null;
        const resolvedFolder = await resolveDriveFolderId({
          drive,
          auth,
          explicitFolderId: input.driveFolderId,
          explicitFolderName: input.driveFolderName,
        });
        const folderId = resolvedFolder.folderId;
        const folderName = resolvedFolder.folderName;

        if (!fileId) {
          const queryParts = [`trashed = false`, `mimeType = 'application/pdf'`];
          if (folderId) {
            queryParts.push(`'${escapeDriveQueryValue(folderId)}' in parents`);
          }

          const driveQuery = asString(input.driveQuery);
          if (driveQuery) {
            const escapedDriveQuery = escapeDriveQueryValue(driveQuery);
            queryParts.push(`(name contains '${escapedDriveQuery}' or fullText contains '${escapedDriveQuery}')`);
          }

          const q = queryParts.join(' and ');

          const listed = await drive.files.list({
            auth,
            q,
            pageSize: 5,
            orderBy: 'modifiedTime desc',
            fields: 'files(id,name,webViewLink)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });

          const picked = listed.data.files?.[0];
          fileId = picked?.id ?? null;
          fileName = picked?.name ?? null;
          webViewLink = picked?.webViewLink ?? null;
        }

        if (!fileId) {
          if (!input.driveQuery && !input.driveFileId && !folderId) {
            return {
              check: 'summarize_drive_transcript_pdf',
              status: 'error',
              message:
                'No Drive transcript target provided. Pass driveFileId, driveQuery, driveFolderId, or driveFolderName (for example: Headhunt Transcripts).',
            };
          }

          return {
            check: 'summarize_drive_transcript_pdf',
            status: 'error',
            message: 'No matching transcript PDF found in Google Drive.',
            driveQuery: input.driveQuery ?? null,
            driveFolderId: folderId,
            driveFolderName: folderName,
          };
        }

        if (!fileName || !webViewLink) {
          const details = await drive.files.get({
            auth,
            fileId,
            fields: 'id,name,webViewLink',
            supportsAllDrives: true,
          });

          fileName = details.data.name ?? fileName ?? null;
          webViewLink = details.data.webViewLink ?? webViewLink ?? null;
        }

        const media = await drive.files.get(
          {
            auth,
            fileId,
            alt: 'media',
            supportsAllDrives: true,
          },
          { responseType: 'arraybuffer' },
        );

        const buffer = Buffer.from(media.data as ArrayBuffer);
        const parsed = await pdf(buffer);
        const transcriptText = compactWhitespace(parsed.text || '');

        if (!transcriptText) {
          return {
            check: 'summarize_drive_transcript_pdf',
            status: 'error',
            message: 'Drive PDF was found, but no transcript text could be extracted.',
            driveFileId: fileId,
            fileName,
          };
        }

        const summary = await generateTranscriptSummary({
          sourceText: transcriptText,
          maxChars: input.maxTranscriptChars,
          candidateName: context.candidate?.name ?? null,
          jobTitle: context.job?.title ?? null,
        });

        await persistTranscriptSummary({
          context,
          summary,
          action: 'summarize_drive_transcript_pdf',
          sourceType: 'drive_pdf',
          sourceId: fileId,
          metadata: {
            driveFileId: fileId,
            fileName,
            webViewLink,
            driveFolderId: folderId,
            driveFolderName: folderName,
            transcriptLength: transcriptText.length,
          },
        });

        return {
          check: 'summarize_drive_transcript_pdf',
          status: 'success',
          source: 'drive_pdf',
          candidateId: context.candidate?.id ?? null,
          jobId: context.job?.id ?? null,
          interviewId: context.interview?.id ?? null,
          driveFile: {
            fileId,
            fileName,
            webViewLink,
            folderId,
            folderName,
          },
          transcriptStats: {
            transcriptLength: transcriptText.length,
          },
          summary,
        };
      } catch (error) {
        return {
          check: 'summarize_drive_transcript_pdf',
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Unknown error while summarizing Drive transcript PDF.',
        };
      }
    },
  }),
);
