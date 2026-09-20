import type { ClientRecord } from '../repositories/client.repository.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by auth.middleware once the API key resolves to a client. */
      client?: ClientRecord;
      /** Set by request-id.middleware and echoed in the X-Request-Id header. */
      requestId?: string;
      /** Set by validate.middleware. Read through the `validated()` helper. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
