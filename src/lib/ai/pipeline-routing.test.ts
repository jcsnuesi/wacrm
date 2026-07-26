import { describe, expect, it } from 'vitest';
import { decidePipelineRouting } from './pipeline-routing';
import type {
  PipelineIntentClassification,
  PipelineRoutingConfig,
} from './pipeline-routing-types';

const config: PipelineRoutingConfig = {
  id: 'config',
  accountId: 'account',
  pipelineId: 'pipeline',
  pipelineName: 'Prótesis Capillar',
  isEnabled: true,
  autoThreshold: 0.9,
  suggestThreshold: 0.65,
  createDeals: true,
  forwardOnly: true,
  rules: [
    {
      stageId: 'stage-potential',
      stageName: 'Cliente potencial',
      position: 1,
      intent: 'potential_customer',
      description: 'Shows commercial interest.',
      examples: ['cuánto cuesta'],
    },
  ],
};

function classification(confidence: number): PipelineIntentClassification {
  return {
    proposedStageId: 'stage-potential',
    intent: 'potential_customer',
    confidence,
    rationale: 'Explicit interest.',
    evidenceMessageIds: ['message'],
  };
}

describe('decidePipelineRouting', () => {
  it('auto-applies classifications at or above 0.90', () => {
    expect(decidePipelineRouting(config, classification(0.9))).toMatchObject({
      initialStatus: 'suggested',
      shouldApply: true,
    });
  });

  it('suggests classifications from 0.65 through 0.89', () => {
    expect(decidePipelineRouting(config, classification(0.89))).toMatchObject({
      initialStatus: 'suggested',
      shouldApply: false,
    });
  });

  it('records low-confidence results without suggesting or moving', () => {
    expect(decidePipelineRouting(config, classification(0.64))).toMatchObject({
      initialStatus: 'low_confidence',
      shouldApply: false,
    });
  });

  it('refuses an unknown stage id even with high confidence', () => {
    expect(
      decidePipelineRouting(config, {
        ...classification(0.99),
        proposedStageId: 'foreign-stage',
      })
    ).toMatchObject({
      proposedRule: null,
      initialStatus: 'low_confidence',
      shouldApply: false,
    });
  });
});
