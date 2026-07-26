export const PIPELINE_INTENTS = [
  'new_customer',
  'potential_customer',
  'pending_evaluation',
  'evaluation',
  'installation',
  'maintenance',
  'not_interested',
  'unknown',
] as const;

export type PipelineIntent = (typeof PIPELINE_INTENTS)[number];

export interface PipelineRoutingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface PipelineStageRule {
  stageId: string;
  stageName: string;
  position: number;
  intent: Exclude<PipelineIntent, 'unknown'>;
  description: string;
  examples: string[];
}

export interface PipelineIntentClassification {
  proposedStageId: string | null;
  intent: PipelineIntent;
  confidence: number;
  rationale: string;
  evidenceMessageIds: string[];
}

export interface PipelineRoutingConfig {
  id: string;
  accountId: string;
  pipelineId: string;
  pipelineName: string;
  isEnabled: boolean;
  autoThreshold: number;
  suggestThreshold: number;
  createDeals: boolean;
  forwardOnly: boolean;
  rules: PipelineStageRule[];
}

export type PipelineRoutingEventStatus =
  | 'low_confidence'
  | 'suggested'
  | 'applied'
  | 'ambiguous_deal'
  | 'blocked_regression'
  | 'no_change'
  | 'dismissed'
  | 'undone'
  | 'error';
