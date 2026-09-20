import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WaitTimeBucket } from '@task-engine/shared';
import { EmptyState } from '../../../components/ui/empty-state';
import { axisStyle, gridStyle, tooltipStyle } from './chart-theme';

/**
 * Queue wait is measured from enqueue to the first dispatch, so it is the
 * clearest read on whether the scheduler is keeping up.
 */
export function WaitTimeHistogram({ data }: { data: WaitTimeBucket[] }) {
  if (data.length === 0) return <EmptyState message="No tasks have started in this window yet" />;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="bucket" {...axisStyle} />
        <YAxis allowDecimals={false} {...axisStyle} />
        <Tooltip {...tooltipStyle} formatter={(value) => [Number(value), 'tasks']} />
        <Bar dataKey="count" fill="var(--status-cancelling)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
