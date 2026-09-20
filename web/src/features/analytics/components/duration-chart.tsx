import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ExecutionTimeByType } from '@task-engine/shared';
import { EmptyState } from '../../../components/ui/empty-state';
import { axisStyle, gridStyle, tooltipStyle } from './chart-theme';

export function DurationChart({ data }: { data: ExecutionTimeByType[] }) {
  if (data.length === 0) return <EmptyState message="No completed tasks in this window yet" />;

  const points = data.map((row) => ({ type: row.type, seconds: Math.round(row.avgMs / 100) / 10 }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis
          dataKey="type"
          {...axisStyle}
          interval={0}
          angle={-12}
          textAnchor="end"
          height={50}
        />
        <YAxis {...axisStyle} />
        <Tooltip {...tooltipStyle} formatter={(value) => [`${Number(value)}s`, 'average']} />
        <Bar dataKey="seconds" fill="var(--status-running)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
