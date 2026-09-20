import type { Response } from 'express';
import type { ServerEvent } from '@task-engine/shared';
import { SSE_HEARTBEAT_MS } from '../config/constants.js';
import { logger } from '../lib/logger.js';

/**
 * Holds the open SSE connections and writes events to all of them.
 *
 * One heartbeat timer serves every connection rather than one timer each: the
 * comment keeps proxies from closing idle streams, and connections are removed
 * on close — without which the set leaks a writer per browser refresh.
 */
export class SseHub {
  private readonly connections = new Set<Response>();
  private heartbeat: NodeJS.Timeout | null = null;

  start(): void {
    if (this.heartbeat !== null) return;
    this.heartbeat = setInterval(() => this.write(':heartbeat\n\n'), SSE_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Returns the function that detaches this connection. */
  add(res: Response): () => void {
    this.connections.add(res);
    logger.debug({ connections: this.connections.size }, 'sse client connected');

    return () => {
      this.connections.delete(res);
      logger.debug({ connections: this.connections.size }, 'sse client disconnected');
    };
  }

  broadcast(event: ServerEvent): void {
    this.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  size(): number {
    return this.connections.size;
  }

  close(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const connection of this.connections) connection.end();
    this.connections.clear();
  }

  private write(chunk: string): void {
    for (const connection of this.connections) {
      // A browser that vanished without a close event leaves a dead socket;
      // dropping it here keeps one bad connection from breaking the broadcast.
      if (!connection.write(chunk)) continue;
    }
  }
}
