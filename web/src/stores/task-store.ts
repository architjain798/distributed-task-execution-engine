import { create } from 'zustand';
import type { Dashboard, ServerEvent, Task, TaskStatus, WorkerStats } from '@task-engine/shared';
import { isTerminal } from '@task-engine/shared';

/**
 * The live view of the system: hydrated once from GET /api/dashboard, then
 * mutated only by SSE events.
 *
 * Paginated task lists and analytics are *not* here — they belong to TanStack
 * Query. Splitting them means no task row is owned by two caches that can
 * disagree.
 */

/** Terminal tasks kept in memory, so a dashboard left open all day stays bounded. */
const RECENT_TERMINAL_LIMIT = 50;

const OFFLINE: WorkerStats = { total: 0, busy: 0, idle: 0, updatedAt: null };

interface TaskState {
  tasks: Map<string, Task>;
  workers: WorkerStats;
  connected: boolean;
  hydrated: boolean;

  hydrate: (dashboard: Dashboard) => void;
  applyEvent: (event: ServerEvent) => void;
  setConnected: (connected: boolean) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: new Map(),
  workers: OFFLINE,
  connected: false,
  hydrated: false,

  hydrate: (dashboard) => {
    set({
      tasks: new Map(dashboard.tasks.map((task) => [task.id, task])),
      workers: dashboard.workers,
      hydrated: true,
    });
  },

  applyEvent: (event) => {
    set((state) => {
      switch (event.type) {
        case 'workers.stats':
          return { workers: event.workers };

        case 'task.created':
        case 'task.updated': {
          const tasks = new Map(state.tasks);
          tasks.set(event.task.id, event.task);
          return { tasks: evictOldTerminal(tasks) };
        }

        case 'task.progress': {
          const existing = state.tasks.get(event.taskId);
          // Progress for a task we have never seen means our snapshot is older
          // than the stream; the next lifecycle event will introduce it.
          if (existing === undefined) return state;

          const tasks = new Map(state.tasks);
          tasks.set(event.taskId, { ...existing, progress: event.progress });
          return { tasks };
        }
      }
    });
  },

  setConnected: (connected) => {
    // Worker stats are left alone: losing the event stream says nothing about
    // whether the worker process is alive, and the snapshot refetch on reconnect
    // will correct them.
    set({ connected });
  },
}));

/** Keeps only the most recently finished terminal tasks. Active tasks are never evicted. */
function evictOldTerminal(tasks: Map<string, Task>): Map<string, Task> {
  const terminal = [...tasks.values()]
    .filter((task) => isTerminal(task.status))
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));

  if (terminal.length <= RECENT_TERMINAL_LIMIT) return tasks;

  for (const task of terminal.slice(RECENT_TERMINAL_LIMIT)) tasks.delete(task.id);
  return tasks;
}

/** Groups the live tasks into the five dashboard columns. */
export function groupByStatus(tasks: Map<string, Task>): Record<TaskStatus, Task[]> {
  const groups: Record<string, Task[]> = {
    queued: [],
    running: [],
    cancelling: [],
    completed: [],
    failed: [],
    cancelled: [],
    dead_letter: [],
  };

  for (const task of tasks.values()) groups[task.status]?.push(task);

  groups.queued?.sort(byPriorityThenAge);
  groups.running?.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  for (const status of ['completed', 'failed', 'cancelled', 'dead_letter']) {
    groups[status]?.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  }

  return groups;
}

/** Mirrors the server's queue ordering, so the UI shows what will run next. */
function byPriorityThenAge(a: Task, b: Task): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.enqueuedAt.localeCompare(b.enqueuedAt);
}
