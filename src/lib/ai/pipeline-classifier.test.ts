import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPipelineIntent } from './pipeline-classifier';
import type { PipelineStageRule } from './pipeline-routing-types';
import evalCases from './fixtures/pipeline-intent-eval.json';

const messages = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'user' as const,
    content: 'hola',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    role: 'user' as const,
    content: 'quiero una evaluación',
  },
];
const stages: PipelineStageRule[] = [
  {
    stageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    stageName: 'Nuevo Cliente',
    position: 0,
    intent: 'new_customer',
    description: 'Saludo sin señal comercial.',
    examples: ['hola'],
  },
  {
    stageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    stageName: 'Pendiente evaluación',
    position: 2,
    intent: 'pending_evaluation',
    description: 'Solicita una evaluación.',
    examples: ['quiero una evaluación'],
  },
];

function response(payload: unknown, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      ...extra,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('classifyPipelineIntent', () => {
  it('ships an anonymized evaluation set covering every routing intent', () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(evalCases.map((item) => item.expectedIntent))).toEqual(
      new Set([
        'new_customer',
        'potential_customer',
        'pending_evaluation',
        'evaluation',
        'installation',
        'maintenance',
        'not_interested',
        'unknown',
      ])
    );
  });

  it('returns and validates a strict stage classification', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        proposedStageId: stages[1].stageId,
        intent: 'pending_evaluation',
        confidence: 0.94,
        rationale: 'The latest message explicitly requests an evaluation.',
        evidenceMessageIds: [messages[1].id],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifyPipelineIntent({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      messages,
      stages,
    });

    expect(result.classification).toMatchObject({
      proposedStageId: stages[1].stageId,
      intent: 'pending_evaluation',
      confidence: 0.94,
    });
    expect(result.usage?.totalTokens).toBe(15);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(
      request.response_format.json_schema.schema.properties.proposedStageId
        .anyOf[0].enum
    ).toEqual(stages.map((stage) => stage.stageId));
  });

  it('accepts unknown classifications only without a proposed stage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          proposedStageId: null,
          intent: 'unknown',
          confidence: 0.4,
          rationale: 'Ambiguous.',
          evidenceMessageIds: [],
        })
      )
    );
    const result = await classifyPipelineIntent({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      messages,
      stages,
    });
    expect(result.classification.proposedStageId).toBeNull();
  });

  it('rejects out-of-range confidence instead of clamping it into an auto-move', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          proposedStageId: stages[1].stageId,
          intent: 'pending_evaluation',
          confidence: 1.2,
          rationale: 'Invalid confidence.',
          evidenceMessageIds: [messages[1].id],
        })
      )
    );
    await expect(
      classifyPipelineIntent({
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        messages,
        stages,
      })
    ).rejects.toThrow('invalid intent or confidence');
  });

  it('rejects evidence ids that were not supplied to the model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          proposedStageId: stages[1].stageId,
          intent: 'pending_evaluation',
          confidence: 0.95,
          rationale: 'Invalid evidence.',
          evidenceMessageIds: ['99999999-9999-4999-8999-999999999999'],
        })
      )
    );
    await expect(
      classifyPipelineIntent({
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        messages,
        stages,
      })
    ).rejects.toThrow('invalid intent or confidence');
  });

  it('rejects a stage and intent mismatch instead of parsing free text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          proposedStageId: stages[0].stageId,
          intent: 'pending_evaluation',
          confidence: 0.99,
          rationale: 'Mismatch.',
          evidenceMessageIds: [messages[1].id],
        })
      )
    );
    await expect(
      classifyPipelineIntent({
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        messages,
        stages,
      })
    ).rejects.toThrow('stage/intent mismatch');
  });

  it('surfaces provider refusals without returning a fallback classification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { refusal: 'cannot classify' } }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );
    await expect(
      classifyPipelineIntent({
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        messages,
        stages,
      })
    ).rejects.toThrow('refused classification');
  });
});
