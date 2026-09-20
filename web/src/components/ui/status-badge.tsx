import type { TaskStatus } from '@task-engine/shared';
import { statusLabel } from '../../utils/format';

/** Colour comes from a CSS variable per status, so the palette lives in one file. */
export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className="badge"
      style={{ '--badge-color': `var(--status-${status})` } as React.CSSProperties}
    >
      {statusLabel(status)}
    </span>
  );
}
