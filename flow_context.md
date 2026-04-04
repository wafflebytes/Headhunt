# Flow Context

Last updated: 2026-04-05

## Current Business Flow (Validated)

1. Scheduling request send
- Handler: scheduling.request.send
- Required inputs for this demo flow: sendMode=send, username=headhunt, eventTypeSlug=30min
- Expected result: mode=request_sent (availability email delivered)

2. Candidate reply parse and booking
- Handler: scheduling.reply.parse_book
- Parses candidate option reply (for example option 1)
- Creates Cal booking and updates stage to interview_scheduled
- Expected result: mode=scheduled with Cal booking UID

3. Offer draft follow-up (automatic)
- Trigger: successful scheduling.reply.parse_book with mode=scheduled
- Follow-up handler: offer.draft.create
- Payload includes autoSubmitOffer=true
- Idempotency uses interview fingerprint (interviewId or bookingUid or slot time)

4. Offer submit/send follow-up (automatic)
- Trigger: successful offer.draft.create when autoSubmitOffer=true
- Follow-up handler: offer.submit.clearance
- Automation path enqueues CIBA clearance and waits for founder approval
- Expected result: mode=awaiting_clearance, then poll transitions to mode=sent_after_clearance

5. Cal-only interview notification policy
- For Cal-managed bookings, the app must not send local interview confirmation email.
- Candidate scheduling notifications should come from Cal only.

## Runtime Behavior (Important)

- processQueue now drains in multiple claim rounds inside one invocation (not single claim-only pass).
- booking mode in agent-liaison now defaults processNowLimit to 6 (if caller does not override), so schedule -> offer draft -> offer submit can complete in one request cycle.
- offer.submit.clearance errors with message "Offer not found. Draft an offer first, then submit it for clearance." are now treated as terminal and moved to dead_letter instead of repeated retries.

## Latest Verified Run Chain

- Request sent: a79d8181d1f6464b830ac12fccddc1de
- Booking scheduled (Cal UID abkf3unMvNB2cJYNu84gDt): c08c77d3b6ac4bfaa9bb05a0f137f678
- Offer draft created (offerId zj7yhar2r7pdvy78goacd): 45806057f3bc48d1a612aa1ec3101a18
- Offer submit queued CIBA clearance (awaiting approval): 68bffce24cb249f79a6e07d0f248b4c4
- Stale submit for deleted offer dead-lettered as expected: e4d3bf7af9f542b9aae7e4c0f3f70e89

## Clean Validation Playbook

1. Reset candidate/application stage and remove candidate interviews/offers.
2. Dead-letter pending/retrying scheduling runs for that candidate before starting a fresh validation.
3. Send request mode with explicit Cal identity if env defaults are missing.
4. Wait candidate reply window.
5. Trigger book mode and verify scheduled + offer chain results.
