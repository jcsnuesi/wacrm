import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

function dbMissingOptionalThenReturning(
  row: Record<string, unknown> | null,
): SupabaseClient {
  let calls = 0
  const chain = {
    from: () => chain,
    select: () => {
      calls += 1
      return chain
    },
    eq: () => chain,
    maybeSingle: () =>
      calls === 1
        ? Promise.resolve({
            data: null,
            error: {
              code: 'PGRST204',
              message:
                "Could not find the 'embeddings_api_key' column of 'ai_configs' in the schema cache",
            },
          })
        : Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })

  it('falls back when optional ai_configs columns are missing', async () => {
    const config = await loadAiConfig(
      dbMissingOptionalThenReturning({
        ...ROW,
        is_active: true,
        handoff_agent_id: undefined,
        embeddings_api_key: undefined,
      }),
      'acct',
    )

    expect(config).not.toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.handoffAgentId).toBeNull()
    expect(config!.embeddingsApiKey).toBeNull()
  })
})
