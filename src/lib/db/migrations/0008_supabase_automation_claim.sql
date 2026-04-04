CREATE OR REPLACE FUNCTION automation_enqueue_run(
  p_handler_type varchar,
  p_resource_type varchar,
  p_resource_id varchar,
  p_idempotency_key varchar,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_next_attempt_at timestamp DEFAULT now(),
  p_max_attempts integer DEFAULT 8,
  p_replayed_from_run_id varchar DEFAULT null
)
RETURNS TABLE(inserted boolean, run_id varchar)
LANGUAGE plpgsql
AS $$
BEGIN
  run_id := null;

  INSERT INTO automation_runs (
    handler_type,
    resource_type,
    resource_id,
    replayed_from_run_id,
    idempotency_key,
    status,
    payload,
    result,
    attempt_count,
    max_attempts,
    next_attempt_at,
    updated_at
  )
  VALUES (
    p_handler_type,
    p_resource_type,
    p_resource_id,
    p_replayed_from_run_id,
    left(trim(p_idempotency_key), 250),
    'pending',
    coalesce(p_payload, '{}'::jsonb),
    '{}'::jsonb,
    0,
    greatest(coalesce(p_max_attempts, 8), 1),
    coalesce(p_next_attempt_at, now()),
    now()
  )
  ON CONFLICT (handler_type, idempotency_key)
  DO NOTHING
  RETURNING id INTO run_id;

  inserted := run_id IS NOT NULL;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION automation_replay_run(p_run_id varchar)
RETURNS TABLE(id varchar, status varchar)
LANGUAGE plpgsql
AS $$
DECLARE
  existing automation_runs%ROWTYPE;
  replay_id varchar;
  replay_idempotency_key varchar;
BEGIN
  SELECT *
  INTO existing
  FROM automation_runs
  WHERE automation_runs.id = p_run_id
  LIMIT 1;

  IF existing.id IS NULL THEN
    RETURN;
  END IF;

  replay_idempotency_key := left(
    concat_ws(':', existing.idempotency_key, 'replay', to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    250
  );

  INSERT INTO automation_runs (
    handler_type,
    resource_type,
    resource_id,
    replayed_from_run_id,
    idempotency_key,
    status,
    payload,
    result,
    attempt_count,
    max_attempts,
    next_attempt_at,
    updated_at
  )
  VALUES (
    existing.handler_type,
    existing.resource_type,
    existing.resource_id,
    existing.id,
    replay_idempotency_key,
    'pending',
    coalesce(existing.payload, '{}'::jsonb),
    '{}'::jsonb,
    0,
    greatest(coalesce(existing.max_attempts, 8), 1),
    now(),
    now()
  )
  RETURNING automation_runs.id, automation_runs.status
  INTO id, status;

  RETURN NEXT;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION automation_enqueue_watchdogs(
  p_reply_stale_hours integer DEFAULT 48,
  p_transcript_stale_hours integer DEFAULT 2,
  p_offer_pending_hours integer DEFAULT 24,
  p_actor_user_id varchar DEFAULT null
)
RETURNS TABLE(enqueued integer)
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count integer := 0;
  total_enqueued integer := 0;
  now_bucket_hour varchar := to_char(now(), 'YYYY-MM-DD"T"HH24');
  dead_letter_count integer := 0;
BEGIN
  INSERT INTO automation_runs (
    handler_type,
    resource_type,
    resource_id,
    idempotency_key,
    status,
    payload,
    result,
    attempt_count,
    max_attempts,
    next_attempt_at,
    updated_at
  )
  SELECT
    'scheduling.reply.reminder',
    'candidate',
    stale_replies.candidate_id,
    left(concat_ws(':', 'reply-stale', stale_replies.candidate_id, stale_replies.job_id, now_bucket_hour), 250),
    'pending',
    jsonb_build_object(
      'candidateId', stale_replies.candidate_id,
      'jobId', stale_replies.job_id,
      'lastRequestedAt', stale_replies.last_requested_at
    ),
    '{}'::jsonb,
    0,
    2,
    now(),
    now()
  FROM (
    SELECT
      al.resource_id AS candidate_id,
      (al.metadata->>'jobId') AS job_id,
      max(al.timestamp) AS last_requested_at
    FROM audit_logs al
    WHERE al.action IN ('interview.availability.request.sent', 'interview.availability.request.drafted')
      AND al.timestamp < now() - (greatest(coalesce(p_reply_stale_hours, 48), 1)::text || ' hours')::interval
    GROUP BY al.resource_id, (al.metadata->>'jobId')
  ) stale_replies
  LEFT JOIN interviews i
    ON i.candidate_id = stale_replies.candidate_id
    AND i.job_id = stale_replies.job_id
    AND i.status = 'scheduled'
  WHERE stale_replies.job_id IS NOT NULL
    AND i.id IS NULL
  ON CONFLICT (handler_type, idempotency_key)
  DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  total_enqueued := total_enqueued + inserted_count;

  INSERT INTO automation_runs (
    handler_type,
    resource_type,
    resource_id,
    idempotency_key,
    status,
    payload,
    result,
    attempt_count,
    max_attempts,
    next_attempt_at,
    updated_at
  )
  SELECT
    'interview.transcript.fetch',
    'interview',
    i.id,
    left(concat_ws(':', 'transcript-stale', i.id, now_bucket_hour), 250),
    'pending',
    jsonb_build_object(
      'interviewId', i.id,
      'bookingUid', substring(i.google_calendar_event_id from 5),
      'candidateId', i.candidate_id,
      'jobId', i.job_id,
      'scheduledAt', i.scheduled_at,
      'actorUserId', p_actor_user_id
    ),
    '{}'::jsonb,
    0,
    6,
    now(),
    now()
  FROM interviews i
  WHERE i.status = 'scheduled'
    AND i.scheduled_at <= now() - (greatest(coalesce(p_transcript_stale_hours, 2), 1)::text || ' hours')::interval
    AND i.google_calendar_event_id LIKE 'cal:%'
  ON CONFLICT (handler_type, idempotency_key)
  DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  total_enqueued := total_enqueued + inserted_count;

  INSERT INTO automation_runs (
    handler_type,
    resource_type,
    resource_id,
    idempotency_key,
    status,
    payload,
    result,
    attempt_count,
    max_attempts,
    next_attempt_at,
    updated_at
  )
  SELECT
    'offer.clearance.poll',
    'offer',
    o.id,
    left(concat_ws(':', 'offer-pending', o.id, now_bucket_hour), 250),
    'pending',
    jsonb_build_object(
      'offerId', o.id,
      'organizationId', o.organization_id,
      'candidateId', o.candidate_id,
      'jobId', o.job_id,
      'authReqId', o.ciba_auth_req_id,
      'actorUserId', p_actor_user_id
    ),
    '{}'::jsonb,
    0,
    8,
    now(),
    now()
  FROM offers o
  WHERE o.status = 'awaiting_approval'
    AND o.updated_at <= now() - (greatest(coalesce(p_offer_pending_hours, 24), 1)::text || ' hours')::interval
  ON CONFLICT (handler_type, idempotency_key)
  DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  total_enqueued := total_enqueued + inserted_count;

  SELECT count(*)::int INTO dead_letter_count
  FROM automation_runs
  WHERE status = 'dead_letter';

  IF dead_letter_count > 0 THEN
    INSERT INTO automation_runs (
      handler_type,
      resource_type,
      resource_id,
      idempotency_key,
      status,
      payload,
      result,
      attempt_count,
      max_attempts,
      next_attempt_at,
      updated_at
    )
    VALUES (
      'dead_letter.notify',
      'automation',
      'dead_letter',
      left(concat_ws(':', 'dead-letter-notify', now_bucket_hour), 250),
      'pending',
      jsonb_build_object(
        'deadLetterCount', dead_letter_count,
        'generatedAt', now()
      ),
      '{}'::jsonb,
      0,
      3,
      now(),
      now()
    )
    ON CONFLICT (handler_type, idempotency_key)
    DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    total_enqueued := total_enqueued + inserted_count;
  END IF;

  INSERT INTO audit_logs (
    organization_id,
    actor_type,
    actor_id,
    actor_display_name,
    action,
    resource_type,
    resource_id,
    metadata,
    result
  )
  VALUES (
    null,
    'system',
    'automation.watchdogs',
    'Automation Watchdog',
    'automation.watchdogs.enqueued',
    'automation',
    'watchdogs',
    jsonb_build_object(
      'enqueued', total_enqueued,
      'replyStaleHours', greatest(coalesce(p_reply_stale_hours, 48), 1),
      'transcriptStaleHours', greatest(coalesce(p_transcript_stale_hours, 2), 1),
      'offerPendingHours', greatest(coalesce(p_offer_pending_hours, 24), 1)
    ),
    'success'
  );

  enqueued := total_enqueued;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION automation_claim_due_runs(p_limit integer DEFAULT 20)
RETURNS SETOF automation_runs
LANGUAGE plpgsql
AS $$
DECLARE
  run_row automation_runs%ROWTYPE;
BEGIN
  FOR run_row IN
    SELECT *
    FROM automation_runs
    WHERE status IN ('pending', 'retrying')
      AND next_attempt_at <= now()
    ORDER BY next_attempt_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_limit, 1), 1)
  LOOP
    UPDATE automation_runs
    SET
      status = 'running',
      started_at = now(),
      updated_at = now()
    WHERE id = run_row.id
    RETURNING * INTO run_row;

    RETURN NEXT run_row;
  END LOOP;

  RETURN;
END;
$$;
