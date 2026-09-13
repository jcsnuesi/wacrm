export interface PotentialIdentity {
  username?: string | null;
  displayName?: string | null;
}

export interface CustomerMatchCandidate extends PotentialIdentity {
  customerId: string;
}

export interface PendingIdentityMatch {
  customerId: string;
  score: number;
  method: 'display_name_exact' | 'username_exact';
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
}

/**
 * Returns review-only candidates from weak identity signals. The caller must
 * persist these as PENDING_REVIEW; this helper never returns an auto-match.
 */
export function findPendingIdentityMatches(
  source: PotentialIdentity,
  candidates: CustomerMatchCandidate[]
): PendingIdentityMatch[] {
  const displayName = normalizeText(source.displayName);
  const username = normalizeText(source.username);
  const matches = new Map<string, PendingIdentityMatch>();

  for (const candidate of candidates) {
    if (displayName && normalizeText(candidate.displayName) === displayName) {
      matches.set(candidate.customerId, {
        customerId: candidate.customerId,
        score: 0.6,
        method: 'display_name_exact',
      });
    }
    if (username && normalizeText(candidate.username) === username) {
      const current = matches.get(candidate.customerId);
      if (!current || current.score < 0.7) {
        matches.set(candidate.customerId, {
          customerId: candidate.customerId,
          score: 0.7,
          method: 'username_exact',
        });
      }
    }
  }

  return [...matches.values()].sort((a, b) => b.score - a.score);
}
