export interface MetaStatusError {
  code?: number;
  title?: string;
  message?: string;
  details?: string;
  error_data?: {
    details?: string;
  };
}

/**
 * Meta accepts some sends synchronously and reports the real delivery error
 * later in a `statuses[].errors` webhook. Keep that detail compact enough to
 * store on the message and show to an agent.
 */
export function formatMetaStatusErrors(
  errors: MetaStatusError[] | undefined
): string | null {
  if (!errors?.length) return null;

  const formatted = errors
    .map((error) => {
      const summary = error.title || error.message || 'Meta delivery error';
      const details = error.error_data?.details || error.details;
      const prefix = error.code == null ? '' : `(#${error.code}) `;

      return details && details !== summary
        ? `${prefix}${summary}: ${details}`
        : `${prefix}${summary}`;
    })
    .filter(Boolean)
    .join(' | ')
    .trim();

  return formatted ? formatted.slice(0, 2000) : null;
}
