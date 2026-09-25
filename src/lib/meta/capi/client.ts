export interface MetaCapiConnection {
  datasetId: string;
  accessToken: string;
  graphApiVersion: string;
  testEventCode?: string | null;
}

export interface MetaCapiResult {
  ok: boolean;
  retryable: boolean;
  status: number;
  body: unknown;
}

export async function sendMetaCapiEvent(
  connection: MetaCapiConnection,
  payload: Record<string, unknown>,
  fetcher: typeof fetch = fetch
): Promise<MetaCapiResult> {
  const body = connection.testEventCode
    ? { ...payload, test_event_code: connection.testEventCode }
    : payload;
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(connection.graphApiVersion)}/${encodeURIComponent(connection.datasetId)}/events`;

  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const responseBody = await response.json().catch(() => null);
    return {
      ok: response.ok,
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
      body: responseBody,
    };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      status: 0,
      body: { error: error instanceof Error ? error.message : 'Network error' },
    };
  }
}
