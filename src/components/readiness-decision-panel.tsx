'use client';

import React from 'react';
import type { ReadinessDecisionArtifact } from '@/types/trace.types';
import { EvidenceChip } from './evidence-chip';

const sectionTitle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#6b7280',
  marginBottom: '4px',
};

function timingText(artifact: ReadinessDecisionArtifact): string {
  const estimate = artifact.timelineEstimate;
  if (estimate.timingStatus === 'no_estimate') return 'No reliable estimate';
  if (estimate.timingStatus === 'behind_historical_trajectory') {
    return `behind historical trajectory by median ${estimate.behindByDaysMedian}d (p25 ${estimate.behindByDaysP25 ?? 'n/a'} / p75 ${estimate.behindByDaysP75 ?? 'n/a'})`;
  }
  return `median ${estimate.remainingDaysMedian}d (p25 ${estimate.remainingDaysP25 ?? 'n/a'} / p75 ${estimate.remainingDaysP75 ?? 'n/a'})`;
}

export function ReadinessDecisionPanel({
  artifact,
}: {
  artifact: ReadinessDecisionArtifact;
}): React.JSX.Element {
  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: '#f9fafb', padding: '10px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
        Readiness decision
      </div>

      <div style={{ fontSize: '12px', color: '#374151', marginBottom: '8px' }}>
        {artifact.targetCase.caseName} ({artifact.targetCase.caseId}) {'->'} {artifact.targetStage}
        {artifact.targetSubStage ? ` / ${artifact.targetSubStage}` : ''} | availability {artifact.availability} | peers {artifact.historicalPeerCount} | confidence {artifact.confidence}
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={sectionTitle}>Cohort</div>
        <div style={{ fontSize: '12px', color: '#374151' }}>{artifact.cohortSelectionCriteria}</div>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={sectionTitle}>Matched signals</div>
        <div style={{ fontSize: '12px', color: '#374151' }}>
          {artifact.matchedSignals.length === 0 ? 'None' : artifact.matchedSignals.map((signal) => signal.label).join(', ')}
        </div>
        {artifact.matchedSignals.flatMap((signal) => signal.evidence).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
            {artifact.matchedSignals
              .flatMap((signal) => signal.evidence)
              .slice(0, 12)
              .map((item, index) => (
                <EvidenceChip key={`${item.sourceId}-${index}`} item={item} />
              ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={sectionTitle}>Missing signals</div>
        <div style={{ fontSize: '12px', color: '#374151' }}>
          {artifact.missingSignals.length === 0 ? 'None' : artifact.missingSignals.map((signal) => signal.label).join(', ')}
        </div>
      </div>

      {artifact.contextDifferences.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={sectionTitle}>Peer context differences</div>
          <div style={{ fontSize: '12px', color: '#374151' }}>
            {artifact.contextDifferences.map((signal) => signal.label).join(', ')}
          </div>
        </div>
      )}

      <div style={{ marginBottom: artifact.uncertaintyReasons.length > 0 ? '8px' : 0 }}>
        <div style={sectionTitle}>Timing estimate</div>
        <div style={{ fontSize: '12px', color: '#374151' }}>
          {timingText(artifact)} | basis {artifact.estimationBasis}
        </div>
      </div>

      {artifact.uncertaintyReasons.length > 0 && (
        <div>
          <div style={sectionTitle}>Uncertainty</div>
          <div style={{ fontSize: '12px', color: '#374151' }}>{artifact.uncertaintyReasons.join('; ')}</div>
        </div>
      )}
    </div>
  );
}
