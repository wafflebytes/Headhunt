import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function main() {
  const { resumePausedIntakeRunsForActor } = await import('@/lib/automation/resume-paused-runs');
  const { processAutomationQueue } = await import('@/lib/automation/queue');

  const actor = 'google-oauth2|116423176386819416664';
  const resumed = await resumePausedIntakeRunsForActor(actor);
  const processed = await processAutomationQueue(6);

  console.log(JSON.stringify({ resumed, processed }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
