'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  PIPELINE_INTENTS,
  type PipelineIntent,
} from '@/lib/ai/pipeline-routing-types';

interface Stage {
  id: string;
  name: string;
  position: number;
  color: string;
}
interface Pipeline {
  id: string;
  name: string;
  pipeline_stages: Stage[];
}
interface Rule {
  stage_id: string;
  intent: Exclude<PipelineIntent, 'unknown'>;
  description: string;
  examples: string[];
  is_enabled: boolean;
}

const INTENT_LABELS: Record<Exclude<PipelineIntent, 'unknown'>, string> = {
  new_customer: 'New customer',
  potential_customer: 'Potential customer',
  pending_evaluation: 'Pending evaluation',
  evaluation: 'Evaluation',
  installation: 'Installation',
  maintenance: 'Maintenance',
  not_interested: 'Not interested',
};
const ROUTABLE_INTENTS = PIPELINE_INTENTS.filter(
  (intent): intent is Exclude<PipelineIntent, 'unknown'> => intent !== 'unknown'
);

export function AiPipelineRoutingCard({
  canEdit,
  provider,
  aiActive,
}: {
  canEdit: boolean;
  provider: string;
  aiActive: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [autoThreshold, setAutoThreshold] = useState(0.9);
  const [suggestThreshold, setSuggestThreshold] = useState(0.65);
  const [rules, setRules] = useState<Rule[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ai/pipeline-routing/config');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const loadedPipelines = (data.pipelines ?? []) as Pipeline[];
      setPipelines(loadedPipelines);
      if (data.config) {
        setPipelineId(data.config.pipeline_id);
        setEnabled(data.config.is_enabled);
        setAutoThreshold(Number(data.config.auto_threshold));
        setSuggestThreshold(Number(data.config.suggest_threshold));
        setRules(data.rules ?? []);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to load pipeline routing'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectPipeline = (nextPipelineId: string | null) => {
    if (!nextPipelineId) return;
    setPipelineId(nextPipelineId);
    const stages =
      pipelines.find((pipeline) => pipeline.id === nextPipelineId)
        ?.pipeline_stages ?? [];
    setRules(
      [...stages]
        .sort((a, b) => a.position - b.position)
        .slice(0, ROUTABLE_INTENTS.length)
        .map((stage, index) => ({
          stage_id: stage.id,
          intent: ROUTABLE_INTENTS[index],
          description: `Use this stage when the conversation clearly matches “${stage.name}”.`,
          examples: [],
          is_enabled: true,
        }))
    );
  };

  const updateRule = (stageId: string, patch: Partial<Rule>) => {
    setRules((current) =>
      current.map((rule) =>
        rule.stage_id === stageId ? { ...rule, ...patch } : rule
      )
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/ai/pipeline-routing/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline_id: pipelineId,
          is_enabled: enabled,
          auto_threshold: autoThreshold,
          suggest_threshold: suggestThreshold,
          create_deals: true,
          forward_only: true,
          rules,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast.success('AI pipeline routing saved');
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to save pipeline routing'
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedStages =
    pipelines.find((pipeline) => pipeline.id === pipelineId)?.pipeline_stages ??
    [];
  const disabled = !canEdit || saving || provider !== 'openai' || !aiActive;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="text-primary h-4 w-4" /> AI pipeline routing
        </CardTitle>
        <CardDescription>
          Classify every inbound message and move high-confidence deals
          automatically. Lower-confidence results appear in the conversation for
          review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {provider !== 'openai' && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
            Pipeline routing currently requires the OpenAI provider.
          </p>
        )}
        <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Enable automatic routing</p>
            <p className="text-muted-foreground text-xs">
              Kill switch for classification and deal movement.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={disabled || loading}
          />
        </div>
        <div className="space-y-2">
          <Label>Pipeline</Label>
          <Select
            value={pipelineId || null}
            onValueChange={selectPipeline}
            disabled={disabled || loading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select pipeline" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Automatic move threshold</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={autoThreshold}
              onChange={(event) => setAutoThreshold(Number(event.target.value))}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label>Suggestion threshold</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={suggestThreshold}
              onChange={(event) =>
                setSuggestThreshold(Number(event.target.value))
              }
              disabled={disabled}
            />
          </div>
        </div>
        {selectedStages.length > 0 && (
          <div className="space-y-3">
            <Label>Stage intent definitions</Label>
            {[...selectedStages]
              .sort((a, b) => a.position - b.position)
              .map((stage) => {
                const rule = rules.find((item) => item.stage_id === stage.id);
                if (!rule) return null;
                return (
                  <div
                    key={stage.id}
                    className="border-border space-y-3 rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{stage.name}</p>
                      <Select
                        value={rule.intent}
                        onValueChange={(intent) =>
                          intent &&
                          updateRule(stage.id, {
                            intent: intent as Rule['intent'],
                          })
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROUTABLE_INTENTS.map((intent) => (
                            <SelectItem key={intent} value={intent}>
                              {INTENT_LABELS[intent]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      value={rule.description}
                      onChange={(event) =>
                        updateRule(stage.id, {
                          description: event.target.value,
                        })
                      }
                      rows={2}
                      disabled={disabled}
                    />
                    <Input
                      value={rule.examples.join(', ')}
                      onChange={(event) =>
                        updateRule(stage.id, {
                          examples: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Examples separated by commas"
                      disabled={disabled}
                    />
                  </div>
                );
              })}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={disabled || loading || !pipelineId || rules.length === 0}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            routing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
