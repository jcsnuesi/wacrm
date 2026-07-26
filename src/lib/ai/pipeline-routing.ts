import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './admin-client';
import { loadAiConfig } from './config';
import { classifyPipelineIntent } from './pipeline-classifier';
import type {
  PipelineIntentClassification,
  PipelineRoutingConfig,
  PipelineRoutingMessage,
  PipelineStageRule,
} from './pipeline-routing-types';
import { logAiUsage } from './usage';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

interface DispatchPipelineRoutingArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  sourceMessageId: string;
}

interface ConfigRow {
  id: string;
  account_id: string;
  pipeline_id: string;
  is_enabled: boolean;
  auto_threshold: number | string;
  suggest_threshold: number | string;
  create_deals: boolean;
  forward_only: boolean;
  pipelines: { name: string } | null;
}

interface RuleRow {
  stage_id: string;
  intent: PipelineStageRule['intent'];
  description: string;
  examples: string[] | null;
  is_enabled: boolean;
  pipeline_stages: { name: string; position: number } | null;
}

export function decidePipelineRouting(
  config: PipelineRoutingConfig,
  classification: PipelineIntentClassification
) {
  const proposedRule = config.rules.find(
    (rule) => rule.stageId === classification.proposedStageId
  );
  const canSuggest = Boolean(
    proposedRule && classification.confidence >= config.suggestThreshold
  );
  return {
    proposedRule: proposedRule ?? null,
    initialStatus: canSuggest
      ? ('suggested' as const)
      : ('low_confidence' as const),
    shouldApply: Boolean(
      proposedRule && classification.confidence >= config.autoThreshold
    ),
  };
}

export async function loadPipelineRoutingConfig(
  db: SupabaseClient,
  accountId: string
): Promise<PipelineRoutingConfig | null> {
  const { data, error } = await db
    .from('ai_pipeline_routing_configs')
    .select(
      'id, account_id, pipeline_id, is_enabled, auto_threshold, suggest_threshold, create_deals, forward_only, pipelines(name)'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as ConfigRow;

  const { data: rulesData, error: rulesError } = await db
    .from('ai_pipeline_stage_rules')
    .select(
      'stage_id, intent, description, examples, is_enabled, pipeline_stages!inner(name, position, pipeline_id)'
    )
    .eq('config_id', row.id)
    .eq('is_enabled', true)
    .eq('pipeline_stages.pipeline_id', row.pipeline_id);
  if (rulesError) throw rulesError;

  const rules = ((rulesData ?? []) as unknown as RuleRow[])
    .filter((rule) => rule.pipeline_stages)
    .map((rule) => ({
      stageId: rule.stage_id,
      stageName: rule.pipeline_stages!.name,
      position: rule.pipeline_stages!.position,
      intent: rule.intent,
      description: rule.description,
      examples: rule.examples ?? [],
    }))
    .sort((a, b) => a.position - b.position);

  return {
    id: row.id,
    accountId: row.account_id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipelines?.name ?? 'Pipeline',
    isEnabled: row.is_enabled,
    autoThreshold: Number(row.auto_threshold),
    suggestThreshold: Number(row.suggest_threshold),
    createDeals: row.create_deals,
    forwardOnly: row.forward_only,
    rules,
  };
}

async function loadRoutingMessages(
  db: SupabaseClient,
  conversationId: string
): Promise<PipelineRoutingMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('id, sender_type, content_type, content_text')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw error;
  return (data ?? [])
    .reverse()
    .map((message) => {
      const text = message.content_text?.trim();
      const mediaLabel: Record<string, string> = {
        image: 'shared an image/photo',
        document: 'shared a document',
        audio: 'sent an audio message',
        video: 'shared a video',
        location: 'shared a location',
        interactive: 'selected an interactive option',
      };
      const mediaDescription = mediaLabel[message.content_type];
      const content = mediaDescription
        ? `[${message.sender_type === 'customer' ? 'Customer' : 'Business'} ${mediaDescription}]${text ? ` ${text}` : ''}`
        : text;
      if (!content) return null;
      return {
        id: message.id,
        role:
          message.sender_type === 'customer'
            ? ('user' as const)
            : ('assistant' as const),
        content,
      };
    })
    .filter((message): message is PipelineRoutingMessage => message !== null);
}

export async function dispatchInboundToAiPipeline(
  args: DispatchPipelineRoutingArgs
): Promise<void> {
  const { accountId, conversationId, contactId, sourceMessageId } = args;
  try {
    const db = supabaseAdmin();
    const [routingConfig, aiConfig] = await Promise.all([
      loadPipelineRoutingConfig(db, accountId),
      loadAiConfig(db, accountId),
    ]);
    if (!routingConfig?.isEnabled || routingConfig.rules.length === 0) return;
    if (!aiConfig?.isActive || aiConfig.provider !== 'openai') return;

    const rate = checkRateLimit(
      `ai-intent-routing:${accountId}`,
      RATE_LIMITS.aiIntentRoutingAccount
    );
    if (!rate.success) {
      console.warn('[ai pipeline routing] account rate limit reached', {
        accountId,
        conversationId,
      });
      return;
    }

    const messages = await loadRoutingMessages(db, conversationId);
    if (!messages.some((message) => message.id === sourceMessageId)) return;

    let classificationResult: Awaited<
      ReturnType<typeof classifyPipelineIntent>
    >;
    try {
      classificationResult = await classifyPipelineIntent({
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        messages,
        stages: routingConfig.rules,
      });
    } catch (classificationError) {
      const errorMessage =
        classificationError instanceof Error
          ? classificationError.message
          : 'Unknown classifier error';
      const { error: auditError } = await db
        .from('ai_pipeline_routing_events')
        .insert({
          account_id: accountId,
          config_id: routingConfig.id,
          source_message_id: sourceMessageId,
          conversation_id: conversationId,
          contact_id: contactId,
          pipeline_id: routingConfig.pipelineId,
          proposed_stage_id: null,
          intent: 'unknown',
          confidence: 0,
          rationale: '',
          evidence_message_ids: [],
          model: aiConfig.model,
          status: 'error',
          error_message: errorMessage.slice(0, 1000),
        });
      if (auditError && auditError.code !== '23505') {
        console.error(
          '[ai pipeline routing] failed to audit classifier error',
          auditError
        );
      }
      throw classificationError;
    }
    const { classification, usage } = classificationResult;
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'intent_routing',
      provider: 'openai',
      model: aiConfig.model,
      usage,
    });

    const { proposedRule, shouldApply, initialStatus } = decidePipelineRouting(
      routingConfig,
      classification
    );

    const { data: event, error: insertError } = await db
      .from('ai_pipeline_routing_events')
      .insert({
        account_id: accountId,
        config_id: routingConfig.id,
        source_message_id: sourceMessageId,
        conversation_id: conversationId,
        contact_id: contactId,
        pipeline_id: routingConfig.pipelineId,
        proposed_stage_id: proposedRule?.stageId ?? null,
        intent: proposedRule ? classification.intent : 'unknown',
        confidence: classification.confidence,
        rationale: classification.rationale,
        evidence_message_ids: classification.evidenceMessageIds,
        model: aiConfig.model,
        status: initialStatus,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') return;
      throw insertError;
    }
    if (!event || !shouldApply) return;

    const { data: result, error: applyError } = await db.rpc(
      'review_ai_pipeline_routing_event',
      { p_event_id: event.id, p_action: 'apply', p_deal_id: null }
    );
    if (applyError) {
      await db
        .from('ai_pipeline_routing_events')
        .update({ status: 'error', error_message: applyError.message })
        .eq('id', event.id);
      throw applyError;
    }
    console.info('[ai pipeline routing] completed', {
      accountId,
      conversationId,
      eventId: event.id,
      intent: classification.intent,
      confidence: classification.confidence,
      result,
    });
  } catch (error) {
    console.error('[ai pipeline routing] dispatch failed', {
      accountId,
      conversationId,
      sourceMessageId,
      error,
    });
  }
}
