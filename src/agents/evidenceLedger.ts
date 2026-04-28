export interface EvidenceLedger {
  directFacts: string[];
  proxies: string[];
  sparseDataReasons: string[];
  ambiguities: string[];
  unsupportedClaims: string[];
}

export function createEvidenceLedger(): EvidenceLedger {
  return {
    directFacts: [],
    proxies: [],
    sparseDataReasons: [],
    ambiguities: [],
    unsupportedClaims: [],
  };
}

function pushUnique(target: string[], value: string | null | undefined): void {
  const clean = value?.trim();
  if (!clean || target.includes(clean)) return;
  target.push(clean);
}

export function observeToolResult(
  ledger: EvidenceLedger,
  toolName: string,
  result: unknown
): void {
  if (!result || typeof result !== 'object') return;
  const record = result as Record<string, unknown>;

  if (toolName === 'findCase' && Array.isArray(record.hits)) {
    const hits = record.hits as Array<Record<string, unknown>>;
    const [first, second] = hits;
    if (
      first &&
      second &&
      first.rank === second.rank &&
      first.matchReason === second.matchReason
    ) {
      pushUnique(ledger.ambiguities, 'findCase returned multiple equally ranked candidates.');
    }
  }

  if (typeof record.availability === 'string' && ['sparse_stage', 'none'].includes(record.availability)) {
    pushUnique(
      ledger.sparseDataReasons,
      `${toolName} returned availability=${record.availability}.`
    );
  }

  if (Array.isArray(record.uncertaintyReasons)) {
    for (const reason of record.uncertaintyReasons) {
      if (typeof reason === 'string') pushUnique(ledger.sparseDataReasons, reason);
    }
  }

  if (record.timingStatus === 'no_estimate' || record.timingStatus === 'snapshot_proxy') {
    pushUnique(ledger.proxies, `${toolName} timingStatus=${String(record.timingStatus)}.`);
  }

  if (record.status === 'no_observed_transitions') {
    pushUnique(ledger.sparseDataReasons, 'No observed stage transitions were found.');
  }

  if (record.truncated === true) {
    pushUnique(ledger.proxies, `${toolName} returned a truncated result set.`);
  }

  if (record.denominator === 'bucketMemberships') {
    pushUnique(
      ledger.proxies,
      `${toolName} counts bucket memberships, not mutually exclusive portfolio cases.`
    );
  }
}
