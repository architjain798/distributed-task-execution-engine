import type { ControlCommand, ServerEvent } from '@task-engine/shared';
import { controlCommandSchema, serverEventSchema } from '@task-engine/shared';
import type { RedisClient } from '../lib/redis.js';
import { redisKeys } from '../lib/redis-keys.js';
import { logger } from '../lib/logger.js';

/**
 * The only channel between the api and worker processes.
 *
 * `channel:events` carries task lifecycle and progress from the worker to every
 * api instance, which fans it out over SSE. `channel:control` carries
 * cancellation the other way.
 *
 * Messages are parsed on arrival rather than trusted: a malformed payload from a
 * mismatched deployment is dropped with a log line instead of crashing a
 * subscriber.
 */
export class EventBus {
  constructor(
    private readonly publisher: RedisClient,
    private readonly subscriber: RedisClient,
  ) {}

  async publishEvent(event: ServerEvent): Promise<void> {
    await this.publisher.publish(redisKeys.eventsChannel, JSON.stringify(event));
  }

  async publishControl(command: ControlCommand): Promise<void> {
    await this.publisher.publish(redisKeys.controlChannel, JSON.stringify(command));
  }

  async publishCancel(taskId: string): Promise<void> {
    await this.publishControl({ type: 'task.cancel', taskId });
  }

  async onEvent(handler: (event: ServerEvent) => void): Promise<void> {
    await this.subscribe(redisKeys.eventsChannel, (raw) => {
      const parsed = serverEventSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ raw }, 'discarding unrecognised event');
        return;
      }
      handler(parsed.data);
    });
  }

  async onControl(handler: (command: ControlCommand) => void): Promise<void> {
    await this.subscribe(redisKeys.controlChannel, (raw) => {
      const parsed = controlCommandSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ raw }, 'discarding unrecognised control message');
        return;
      }
      handler(parsed.data);
    });
  }

  private async subscribe(channel: string, handler: (raw: unknown) => void): Promise<void> {
    await this.subscriber.subscribe(channel);

    this.subscriber.on('message', (incoming: string, payload: string) => {
      if (incoming !== channel) return;
      try {
        handler(JSON.parse(payload));
      } catch (error) {
        logger.warn({ err: error, channel }, 'unparseable message on channel');
      }
    });
  }
}
