export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatRelative(iso: string | null): string {
  if (iso === null) return '—';

  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function formatTime(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleTimeString();
}

/** Task ids are UUIDs; the first segment is enough to recognise one on screen. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function statusLabel(status: string): string {
  return status.replace('_', ' ');
}
