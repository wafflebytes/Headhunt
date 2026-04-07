import { Login01Icon, UserAdd01Icon } from '@hugeicons/core-free-icons';
import { desc, eq } from 'drizzle-orm';
import { ChatWindow } from '@/components/chat-window';
import { GuideInfoBox } from '@/components/guide/GuideInfoBox';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';
import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema/jobs';

const PRESET_JOB_OPTIONS = [
  {
    id: 'job_demo_founding_engineer',
    title: 'Founding Engineer',
  },
  {
    id: 'job_demo_product_designer',
    title: 'Product Designer',
  },
  {
    id: 'job_demo_recruiting_coordinator',
    title: 'Recruiting Coordinator',
  },
  {
    id: 'job_demo_growth_marketer',
    title: 'Growth Marketer',
  },
] as const;

type JobOption = {
  id: string;
  title: string;
  organizationId: string | null;
  isActive: boolean;
};

const ACTIVE_JOBS_QUERY_TIMEOUT_MS = 1500;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export default async function Home() {
  let session = null;
  try {
    session = await auth0.getSession();
  } catch (error) {
    console.warn('Failed to load Auth0 session on home page.', error);
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] my-auto gap-4">
        <h2 className="text-xl">You are not logged in</h2>
        <div className="flex gap-4">
          <Button asChild variant="default" size="default">
            <a href="/auth/login?prompt=login&max_age=0" className="flex items-center gap-2">
              <HugeIcon icon={Login01Icon} size={18} strokeWidth={2.2} />
              <span>Login</span>
            </a>
          </Button>
          <Button asChild variant="default" size="default">
            <a href="/auth/login?screen_hint=signup&prompt=login&max_age=0">
              <HugeIcon icon={UserAdd01Icon} size={18} strokeWidth={2.2} />
              <span>Sign up</span>
            </a>
          </Button>
        </div>
      </div>
    );
  }

  const chatUserId = session.user?.sub ?? session.user?.email ?? null;

  if (!chatUserId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] my-auto gap-4">
        <h2 className="text-xl">Unable to determine account identity</h2>
        <p className="text-sm text-muted-foreground">Please sign in again to start an isolated chat session.</p>
        <Button asChild variant="default" size="default">
          <a href="/auth/login?prompt=login&max_age=0" className="flex items-center gap-2">
            <HugeIcon icon={Login01Icon} size={18} strokeWidth={2.2} />
            <span>Sign in again</span>
          </a>
        </Button>
      </div>
    );
  }

  let activeJobs: Array<{ id: string; title: string; organizationId: string | null }> = [];
  try {
    activeJobs = await withTimeout(
      db
        .select({
          id: jobs.id,
          title: jobs.title,
          organizationId: jobs.organizationId,
        })
        .from(jobs)
        .where(eq(jobs.status, 'active'))
        .orderBy(desc(jobs.updatedAt))
        .limit(50),
      ACTIVE_JOBS_QUERY_TIMEOUT_MS,
      'Active jobs query timed out.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Active jobs unavailable (${message}). Falling back to preset options.`);
  }

  const normalizedActiveJobs: JobOption[] = activeJobs.map((job: { id: string; title: string; organizationId: string | null }) => ({
    id: job.id,
    title: job.title,
    organizationId: job.organizationId,
    isActive: true,
  }));

  const mergedPresetJobs: JobOption[] = PRESET_JOB_OPTIONS.map((preset) => {
    const matched = normalizedActiveJobs.find(
      (job: JobOption) =>
        job.id === preset.id ||
        job.title.trim().toLowerCase() === preset.title.trim().toLowerCase(),
    );

    if (matched) {
      return matched;
    }

    return {
      id: preset.id,
      title: preset.title,
      organizationId: null,
      isActive: false,
    };
  });

  const remainingActiveJobs = normalizedActiveJobs.filter(
    (job: JobOption) =>
      !mergedPresetJobs.some(
        (option: JobOption) =>
          option.id === job.id ||
          option.title.trim().toLowerCase() === job.title.trim().toLowerCase(),
      ),
  );

  const chatJobOptions = [...mergedPresetJobs, ...remainingActiveJobs];
  const defaultJobId =
    chatJobOptions.find(
      (option) => option.isActive && /founding\s+engineer/i.test(option.title),
    )?.id ?? chatJobOptions.find((option) => option.isActive)?.id;

  const InfoCard = (
    <GuideInfoBox>
      <ul>
        <li className="text-l">
          🤝
          <span className="ml-2">
            This template showcases a simple chatbot using Vercel&apos;s{' '}
            <a className="text-blue-500" href="https://sdk.vercel.ai/docs" target="_blank">
              AI SDK
            </a>{' '}
            in a{' '}
            <a className="text-blue-500" href="https://nextjs.org/" target="_blank">
              Next.js
            </a>{' '}
            project.
          </span>
        </li>
        <li className="hidden text-l md:block">
          💻
          <span className="ml-2">
            You can find the prompt and model logic for this use-case in <code>app/api/chat/route.ts</code>.
          </span>
        </li>
        <li className="hidden text-l md:block">
          🎨
          <span className="ml-2">
            The main frontend logic is found in <code>app/page.tsx</code>.
          </span>
        </li>
        <li className="text-l">
          👇
          <span className="ml-2">
            Try asking e.g. <code>What can you help me with?</code> below!
          </span>
        </li>
      </ul>
    </GuideInfoBox>
  );

  return (
    <ChatWindow
      key={chatUserId}
      endpoint="api/chat"
      emoji="🤖"
      placeholder={`Hello ${session?.user?.name}, I'm your personal assistant. How can I help you today?`}
      emptyStateComponent={InfoCard}
      userId={chatUserId}
      jobOptions={chatJobOptions}
      defaultJobId={defaultJobId}
    />
  );
}
