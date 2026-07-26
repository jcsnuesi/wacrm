import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { PIPELINE_INTENTS } from '@/lib/ai/pipeline-routing-types';

const ROUTABLE_INTENTS = PIPELINE_INTENTS.filter(
  (intent) => intent !== 'unknown'
);

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const [
      { data: pipelines, error: pipelinesError },
      { data: config, error: configError },
    ] = await Promise.all([
      supabase
        .from('pipelines')
        .select('id, name, pipeline_stages(id, name, position, color)')
        .eq('account_id', accountId)
        .order('created_at'),
      supabase
        .from('ai_pipeline_routing_configs')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
    ]);
    if (pipelinesError || configError) {
      console.error('[ai/pipeline-routing/config GET] failed', {
        pipelinesError,
        configError,
      });
      return NextResponse.json(
        { error: 'Failed to load pipeline routing' },
        { status: 500 }
      );
    }

    let rules: unknown[] = [];
    if (config) {
      const { data, error } = await supabase
        .from('ai_pipeline_stage_rules')
        .select('id, stage_id, intent, description, examples, is_enabled')
        .eq('config_id', config.id);
      if (error) {
        console.error('[ai/pipeline-routing/config GET] rules failed', error);
        return NextResponse.json(
          { error: 'Failed to load stage rules' },
          { status: 500 }
        );
      }
      rules = data ?? [];
    }

    return NextResponse.json({
      configured: Boolean(config),
      config,
      rules,
      pipelines: pipelines ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-pipeline-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const pipelineId =
      typeof body?.pipeline_id === 'string' ? body.pipeline_id : '';
    const autoThreshold = Number(body?.auto_threshold ?? 0.9);
    const suggestThreshold = Number(body?.suggest_threshold ?? 0.65);
    const rules = Array.isArray(body?.rules) ? body.rules : [];
    if (
      !pipelineId ||
      !Number.isFinite(autoThreshold) ||
      !Number.isFinite(suggestThreshold) ||
      autoThreshold < 0 ||
      suggestThreshold > 1 ||
      suggestThreshold < 0 ||
      autoThreshold > 1 ||
      suggestThreshold > autoThreshold
    ) {
      return NextResponse.json(
        { error: 'Invalid pipeline or confidence thresholds' },
        { status: 400 }
      );
    }

    const { data: pipeline } = await supabase
      .from('pipelines')
      .select('id, pipeline_stages(id)')
      .eq('id', pipelineId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!pipeline)
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    const validStageIds = new Set(
      ((pipeline.pipeline_stages ?? []) as { id: string }[]).map(
        (stage) => stage.id
      )
    );
    const seenIntents = new Set<string>();
    const seenStages = new Set<string>();
    const normalizedRules: {
      stage_id: string;
      intent: string;
      description: string;
      examples: string[];
      is_enabled: boolean;
    }[] = [];
    for (const raw of rules) {
      const stageId = typeof raw?.stage_id === 'string' ? raw.stage_id : '';
      const intent = typeof raw?.intent === 'string' ? raw.intent : '';
      const description =
        typeof raw?.description === 'string' ? raw.description.trim() : '';
      if (
        !validStageIds.has(stageId) ||
        seenStages.has(stageId) ||
        !ROUTABLE_INTENTS.includes(
          intent as (typeof ROUTABLE_INTENTS)[number]
        ) ||
        seenIntents.has(intent) ||
        !description
      ) {
        return NextResponse.json(
          {
            error: 'Every stage rule must be valid and intents must be unique',
          },
          { status: 400 }
        );
      }
      seenIntents.add(intent);
      seenStages.add(stageId);
      normalizedRules.push({
        stage_id: stageId,
        intent,
        description: description.slice(0, 1000),
        examples: Array.isArray(raw.examples)
          ? raw.examples
              .filter((example: unknown) => typeof example === 'string')
              .map((example: string) => example.trim())
              .filter(Boolean)
              .slice(0, 10)
          : [],
        is_enabled: raw.is_enabled !== false,
      });
    }
    if (normalizedRules.length === 0) {
      return NextResponse.json(
        { error: 'At least one stage rule is required' },
        { status: 400 }
      );
    }

    const { data: config, error: configError } = await supabase
      .from('ai_pipeline_routing_configs')
      .upsert(
        {
          account_id: accountId,
          pipeline_id: pipelineId,
          created_by: userId,
          is_enabled: body.is_enabled === true,
          auto_threshold: autoThreshold,
          suggest_threshold: suggestThreshold,
          create_deals: body.create_deals !== false,
          forward_only: body.forward_only !== false,
        },
        { onConflict: 'account_id' }
      )
      .select('id')
      .single();
    if (configError || !config) {
      console.error(
        '[ai/pipeline-routing/config PUT] config failed',
        configError
      );
      return NextResponse.json(
        { error: 'Failed to save pipeline routing' },
        { status: 500 }
      );
    }
    const { error: deleteError } = await supabase
      .from('ai_pipeline_stage_rules')
      .delete()
      .eq('config_id', config.id);
    if (deleteError) {
      console.error(
        '[ai/pipeline-routing/config PUT] rule cleanup failed',
        deleteError
      );
      return NextResponse.json(
        { error: 'Failed to replace stage rules' },
        { status: 500 }
      );
    }
    const { error: rulesError } = await supabase
      .from('ai_pipeline_stage_rules')
      .insert(
        normalizedRules.map((rule) => ({ ...rule, config_id: config.id }))
      );
    if (rulesError) {
      console.error(
        '[ai/pipeline-routing/config PUT] rules failed',
        rulesError
      );
      return NextResponse.json(
        { error: 'Failed to save stage rules' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
