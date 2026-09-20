import type { Request, Response } from 'express';
import type { SseHub } from '../events/sse-hub.js';

/**
 * The SSE endpoint. Clients hydrate once from GET /api/dashboard and then apply
 * the events this streams.
 *
 * Reconnecting refetches the snapshot rather than replaying an event log: five
 * lines and correct by construction, where replay would need retention and
 * ordering guarantees for no benefit at this scale.
 */
export function createEventController(hub: SseHub) {
  return {
    stream(req: Request, res: Response): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        // no-transform stops intermediaries buffering or gzipping the stream,
        // which would hold events back until the buffer filled.
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');

      const detach = hub.add(res);

      // Without this the hub keeps a writer for every browser tab ever opened.
      req.on('close', () => {
        detach();
        res.end();
      });
    },
  };
}
