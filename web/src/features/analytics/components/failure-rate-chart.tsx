import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FailureRateByType } from '@task-engine/shared';
import { EmptyState } from '../../../components/ui/empty-state';
import { axisStyle, gridStyle, tooltipStyle } from './chart-theme';

export function FailureRateChart({ data }: { data: FailureRateByType[] }) {
  if (data.length === 0) return <EmptyState message="No finished tasks in this window yet" />;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis
          dataKey="type"
          {...axisStyle}
          interval={0}
          angle={-12}
          textAnchor="end"
          height={50}
        />
        <YAxis unit="%" {...axisStyle} />
        <Tooltip {...tooltipStyle} formatter={(value) => [`${Number(value)}%`, 'failure rate']} />
        <Bar dataKey="failureRate" fill="var(--status-failed)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
