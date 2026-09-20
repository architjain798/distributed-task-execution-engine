/** Shared Recharts styling, so four charts cannot drift apart visually. */
export const axisStyle = {
  stroke: '#939aa8',
  fontSize: 11,
  tickLine: false,
} as const;

export const gridStyle = {
  stroke: '#2a2f3a',
  strokeDasharray: '3 3',
  vertical: false,
} as const;

export const tooltipStyle = {
  contentStyle: {
    background: '#1e222b',
    border: '1px solid #2a2f3a',
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: '#e6e8ec' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
} as const;
