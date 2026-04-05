'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Add01Icon,
  CalendarCheckIn01Icon,
  Delete02Icon,
  Loading03Icon,
  SaveEnergyIcon,
  SentIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type SlotRangeInput = {
  id: string;
  startLocal: string;
  endLocal: string;
};

type SlotAction = 'save' | 'save_and_send';

type SlotSelectionApiResponse = {
  status: string;
  mode?: string;
  selection?: {
    id: string;
    status: string;
    createdAt: string;
  };
  cal?: {
    eventTypeId: number | null;
    eventTypeSlug: string | null;
    bookingUrl: string | null;
  };
  email?: {
    mode: 'send' | 'draft';
    providerId: string | null;
    providerThreadId: string | null;
    subject: string;
  };
  message?: string;
};

function createRangeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `range-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function createDefaultRange(startOffsetMinutes = 60, durationMinutes = 30): SlotRangeInput {
  const start = new Date(Date.now() + startOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  return {
    id: createRangeId(),
    startLocal: toDateTimeLocalValue(start),
    endLocal: toDateTimeLocalValue(end),
  };
}

function formatResultTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function FounderSlotSelectionPanel(props: {
  defaultJobId?: string | null;
  defaultOrganizationId?: string | null;
  disabled?: boolean;
}) {
  const [candidateId, setCandidateId] = useState('');
  const [jobId, setJobId] = useState(props.defaultJobId ?? '');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [ranges, setRanges] = useState<SlotRangeInput[]>([createDefaultRange()]);
  const [sendMode, setSendMode] = useState<'send' | 'draft'>('send');
  const [customMessage, setCustomMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<SlotAction | null>(null);
  const [latestResult, setLatestResult] = useState<SlotSelectionApiResponse | null>(null);

  useEffect(() => {
    if (!props.defaultJobId) {
      return;
    }

    setJobId((current) => (current ? current : props.defaultJobId ?? ''));
  }, [props.defaultJobId]);

  const isPending = pendingAction !== null;
  const isDisabled = props.disabled || isPending;

  const rangeCountLabel = useMemo(() => {
    if (ranges.length === 1) {
      return '1 range';
    }

    return `${ranges.length} ranges`;
  }, [ranges.length]);

  function updateRange(rangeId: string, field: 'startLocal' | 'endLocal', value: string) {
    setRanges((current) =>
      current.map((range) => (range.id === rangeId ? { ...range, [field]: value } : range)),
    );
  }

  function addRange() {
    setRanges((current) => [...current, createDefaultRange(current.length * 90 + 60)]);
  }

  function removeRange(rangeId: string) {
    setRanges((current) => {
      if (current.length === 1) {
        return current;
      }

      return current.filter((range) => range.id !== rangeId);
    });
  }

  async function submitSelection(action: SlotAction) {
    const trimmedCandidateId = candidateId.trim();
    const trimmedJobId = jobId.trim();
    const duration = Number.parseInt(durationMinutes, 10);

    if (!trimmedCandidateId) {
      toast.error('Candidate ID is required.');
      return;
    }

    if (!trimmedJobId) {
      toast.error('Job ID is required.');
      return;
    }

    if (!Number.isInteger(duration) || duration < 15 || duration > 180) {
      toast.error('Duration must be between 15 and 180 minutes.');
      return;
    }

    const normalizedRanges = ranges
      .map((range) => {
        const startDate = new Date(range.startLocal);
        const endDate = new Date(range.endLocal);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          throw new Error('Each range needs a valid start and end datetime.');
        }

        if (endDate <= startDate) {
          throw new Error('Range end must be after range start.');
        }

        return {
          startISO: startDate.toISOString(),
          endISO: endDate.toISOString(),
        };
      })
      .sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());

    if (normalizedRanges.length === 0) {
      toast.error('At least one slot range is required.');
      return;
    }

    try {
      setPendingAction(action);

      const response = await fetch('/api/scheduling/founder-slot-selection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidateId: trimmedCandidateId,
          jobId: trimmedJobId,
          organizationId: props.defaultOrganizationId ?? undefined,
          timezone: timezone.trim() || 'America/Los_Angeles',
          durationMinutes: duration,
          ranges: normalizedRanges,
          action,
          sendMode,
          customMessage: customMessage.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({
        message: 'Failed to parse API response.',
      }))) as SlotSelectionApiResponse;

      if (!response.ok) {
        throw new Error(payload.message || 'Failed to submit founder slot selection.');
      }

      setLatestResult(payload);

      if (action === 'save_and_send') {
        toast.success(
          sendMode === 'send'
            ? 'Cal link sent on candidate thread.'
            : 'Cal link email draft created on candidate thread.',
        );
      } else {
        toast.success('Founder slot ranges saved.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setPendingAction(null);
    }
  }

  function onSaveOnly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDisabled) {
      return;
    }

    void submitSelection('save');
  }

  return (
    <div className="rounded-md border border-input bg-background/85 p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-medium">Founder Slot Selection</p>
          <p className="text-xs text-muted-foreground">
            Save discontinuous ranges, then optionally generate/send a Cal link on the source email thread.
          </p>
        </div>
        <span className="text-xs rounded-full bg-muted px-2 py-1">{rangeCountLabel}</span>
      </div>

      <form onSubmit={onSaveOnly} className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Input
            placeholder="candidate_id"
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
            disabled={isDisabled}
          />
          <Input
            placeholder="job_id"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Input
            placeholder="America/Los_Angeles"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={isDisabled}
          />
          <Input
            type="number"
            min={15}
            max={180}
            step={5}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            disabled={isDisabled}
          />
          <select
            value={sendMode}
            onChange={(event) => setSendMode(event.target.value as 'send' | 'draft')}
            disabled={isDisabled}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="send">send link email</option>
            <option value="draft">draft link email</option>
          </select>
        </div>

        <div className="space-y-2">
          {ranges.map((range, index) => (
            <div key={range.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr,1fr,auto]">
              <Input
                type="datetime-local"
                value={range.startLocal}
                onChange={(event) => updateRange(range.id, 'startLocal', event.target.value)}
                disabled={isDisabled}
                aria-label={`Range ${index + 1} start`}
              />
              <Input
                type="datetime-local"
                value={range.endLocal}
                onChange={(event) => updateRange(range.id, 'endLocal', event.target.value)}
                disabled={isDisabled}
                aria-label={`Range ${index + 1} end`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDisabled || ranges.length === 1}
                onClick={() => removeRange(range.id)}
                className="h-9"
              >
                <HugeIcon icon={Delete02Icon} size={16} strokeWidth={2.2} className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addRange} disabled={isDisabled}>
          <HugeIcon icon={Add01Icon} size={16} strokeWidth={2.2} className="h-4 w-4 mr-1" />
          Add Discontinuous Range
        </Button>

        <Textarea
          value={customMessage}
          onChange={(event) => setCustomMessage(event.target.value)}
          disabled={isDisabled}
          placeholder="Optional note appended to the candidate email"
          className="min-h-[70px]"
        />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={isDisabled}>
            {pendingAction === 'save' ? (
              <HugeIcon icon={Loading03Icon} size={16} strokeWidth={2.2} className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <HugeIcon icon={SaveEnergyIcon} size={16} strokeWidth={2.2} className="h-4 w-4 mr-1" />
            )}
            Save Ranges Only
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={isDisabled}
            onClick={() => void submitSelection('save_and_send')}
          >
            {pendingAction === 'save_and_send' ? (
              <HugeIcon icon={Loading03Icon} size={16} strokeWidth={2.2} className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <HugeIcon icon={SentIcon} size={16} strokeWidth={2.2} className="h-4 w-4 mr-1" />
            )}
            Save + {sendMode === 'send' ? 'Send' : 'Draft'} Cal Link
          </Button>
        </div>
      </form>

      {latestResult?.selection ? (
        <div className="mt-3 rounded-md border border-input bg-muted/40 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1 font-medium">
            <HugeIcon icon={CalendarCheckIn01Icon} size={16} strokeWidth={2.2} className="h-4 w-4" />
            Latest Selection Saved
          </div>
          <p>Selection ID: {latestResult.selection.id}</p>
          <p>Status: {latestResult.selection.status}</p>
          <p>Created: {formatResultTimestamp(latestResult.selection.createdAt)}</p>
          {latestResult.cal?.bookingUrl ? (
            <p>
              Cal Link:{' '}
              <a
                href={latestResult.cal.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {latestResult.cal.bookingUrl}
              </a>
            </p>
          ) : null}
          {latestResult.email?.providerId ? <p>Email Provider ID: {latestResult.email.providerId}</p> : null}
        </div>
      ) : null}
    </div>
  );
}