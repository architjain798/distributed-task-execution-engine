import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ThroughputPoint } from '@task-engine/shared';
import { EmptyState } from '../../../components/ui/empty-state';
import { axisStyle, gridStyle, tooltipStyle } from './chart-theme';

export function ThroughputChart({ data }: { data: ThroughputPoint[] }) {
  if (data.length === 0) return <EmptyState message="No completed tasks in this window yet" />;

  const points = data.map((point) => ({
    ...point,
    label: new Date(point.minute).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="label" {...axisStyle} />
        <YAxis allowDecimals={false} {...axisStyle} />
        <Tooltip {...tooltipStyle} />
        <Line
          type="monotone"
          dataKey="completed"
          name="tasks/min"
          stroke="var(--status-completed)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
