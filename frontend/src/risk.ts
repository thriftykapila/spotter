import type { ExpressionSpecification } from 'maplibre-gl';
import type { RiskLevel } from './types';

export const riskNames: Record<RiskLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
  no_travel: 'No travel',
  unknown: 'Unknown',
};
export const riskColors: Record<RiskLevel, string> = {
  low: '#23815d',
  moderate: '#c3921b',
  high: '#db7423',
  severe: '#c23c42',
  no_travel: '#111827',
  unknown: '#8a929d',
};
export const riskByScore: RiskLevel[] = ['low', 'moderate', 'high', 'severe', 'no_travel'];
export const levelColorExpression: ExpressionSpecification = [
  'match',
  ['get', 'level'],
  'low',
  riskColors.low,
  'moderate',
  riskColors.moderate,
  'high',
  riskColors.high,
  'severe',
  riskColors.severe,
  'no_travel',
  riskColors.no_travel,
  riskColors.unknown,
];
export function forecastColorExpression(hour: number): ExpressionSpecification {
  return [
    'match',
    ['coalesce', ['at', Math.min(48, Math.max(0, Math.round(hour))), ['get', 'risks']], -1],
    0,
    riskColors.low,
    1,
    riskColors.moderate,
    2,
    riskColors.high,
    3,
    riskColors.severe,
    4,
    riskColors.no_travel,
    riskColors.unknown,
  ];
}
