'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, Loader2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PipelineRoutingEventStatus } from '@/lib/ai/pipeline-routing-types';

interface RoutingEvent {
  id: string;
  deal_id: string | null;
  proposed_stage_id: string | null;
  applied_stage_id: string | null;
  intent: string;
  confidence: number | string;
  rationale: string;
  status: PipelineRoutingEventStatus;
  created_at: string;
}
interface Stage {
  id: string;
  name: string;
  position: number;
}
interface Deal {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  status: string;
}

const ACTIONABLE = new Set<PipelineRoutingEventStatus>([
  'suggested',
  'ambiguous_deal',
  'blocked_regression',
  'applied',
]);

export function AiPipelineRoutingBanner({
  conversationId,
  resyncToken = 0,
}: {
  conversationId: string;
  resyncToken?: number;
}) {
  const [event, setEvent] = useState<RoutingEvent | null>(null);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedDealId, setSelectedDealId] = useState('');
  const [busy, setBusy] = useState(false);
  const [hiddenEventId, setHiddenEventId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/ai/pipeline-routing/events?conversation_id=${encodeURIComponent(conversationId)}`
      );
      if (!response.ok) return;
      const data = await response.json();
      const latest = ((data.events ?? []) as RoutingEvent[])[0] ?? null;
      const next = latest && ACTIONABLE.has(latest.status) ? latest : null;
      setEvent(next);
      setStages(data.stages ?? {});
      setDeals(data.eligible_deals ?? []);
      setSelectedDealId(next?.deal_id ?? '');
    } catch {
      // Best-effort inbox affordance; server logs own routing failures.
    }
  }, [conversationId]);

  useEffect(() => {
    setHiddenEventId(null);
    void load();
  }, [load, resyncToken]);

  // The classifier runs after the webhook response; a short bounded poll
  // lets an open conversation receive its suggestion without requiring the
  // new table to be added to Supabase Realtime publication immediately.
  useEffect(() => {
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const targetStage = event
    ? stages[event.applied_stage_id ?? event.proposed_stage_id ?? '']
    : null;
  const confidence = useMemo(
    () => Math.round(Number(event?.confidence ?? 0) * 100),
    [event?.confidence]
  );

  const act = async (action: 'apply' | 'dismiss' | 'undo') => {
    if (!event) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/ai/pipeline-routing/events/${event.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, deal_id: selectedDealId || null }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast.success(
        action === 'apply'
          ? 'Pipeline stage applied'
          : action === 'undo'
            ? 'AI pipeline move undone'
            : 'Suggestion dismissed'
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update pipeline'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!event || !targetStage || hiddenEventId === event.id) return null;
  const needsDeal = event.status === 'ambiguous_deal';

  return (
    <div className="border-border bg-primary/5 border-t px-4 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="text-primary h-4 w-4" />
        <span className="text-foreground font-medium">
          {event.status === 'applied' ? 'AI moved this deal to' : 'AI suggests'}{' '}
          {targetStage.name}
        </span>
        <Badge variant="outline">{confidence}%</Badge>
        <span
          className="text-muted-foreground min-w-0 flex-1 truncate"
          title={event.rationale}
        >
          {event.rationale}
        </span>
        {needsDeal && (
          <Select
            value={selectedDealId || null}
            onValueChange={(value) => setSelectedDealId(value ?? '')}
          >
            <SelectTrigger className="h-8 w-52">
              <SelectValue placeholder="Select deal" />
            </SelectTrigger>
            <SelectContent>
              {deals.map((deal) => (
                <SelectItem key={deal.id} value={deal.id}>
                  {deal.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {event.status === 'applied' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act('undo')}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Undo2 className="h-3.5 w-3.5" />
            )}{' '}
            Undo
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy || (needsDeal && !selectedDealId)}
              onClick={() => void act('apply')}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void act('dismiss')}
            >
              Dismiss
            </Button>
          </>
        )}
        <button
          type="button"
          onClick={() => setHiddenEventId(event.id)}
          aria-label="Hide AI pipeline routing"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
