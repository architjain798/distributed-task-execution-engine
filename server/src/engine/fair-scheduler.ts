import { DISPATCH_COST } from '../config/constants.js';

/**
 * Deficit Round Robin over per-client queues.
 *
 * The scheduler never looks at a global ordering of tasks. It picks a *client*,
 * and the ready queue then yields that client's highest-priority task. A client
 * flooding the system with priority-5 work therefore fills only its own queue
 * and still receives its share of the pool and no more.
 *
 * The cost is stated plainly in the README: priority orders a client's own work
 * and has no effect across clients.
 *
 * Each client earns `weight` credits when its turn comes round and spends
 * DISPATCH_COST per dispatch, keeping the turn while credit remains. That is
 * what makes a weight of 2.5 mean 2.5x the dispatch rate rather than rounding
 * away — with uniform weights this reduces to plain round robin.
 */
export class FairScheduler {
  private readonly deficits = new Map<string, number>();
  private weights = new Map<string, number>();

  /** The client currently holding the turn, or null between rounds. */
  private current: string | null = null;

  constructor(private readonly defaultWeight = 1) {}

  setWeights(weights: Map<string, number>): void {
    this.weights = weights;
  }

  weightOf(clientId: string): number {
    return this.weights.get(clientId) ?? this.defaultWeight;
  }

  /**
   * Chooses which client dispatches next, or null when no active client can
   * afford a dispatch this round.
   */
  nextClient(activeClients: string[]): string | null {
    // Sorted so the rotation order is stable as clients come and go.
    const clients = [...activeClients].sort();

    if (clients.length === 0) {
      this.current = null;
      return null;
    }

    // A client holding the turn keeps it while it still has credit.
    if (this.current !== null && clients.includes(this.current)) {
      const remaining = this.deficits.get(this.current) ?? 0;
      if (remaining >= DISPATCH_COST) {
        this.deficits.set(this.current, remaining - DISPATCH_COST);
        return this.current;
      }
    }

    const startAt = this.nextStartIndex(clients);

    for (let offset = 0; offset < clients.length; offset += 1) {
      const clientId = clients[(startAt + offset) % clients.length] as string;
      const deficit = (this.deficits.get(clientId) ?? 0) + this.weightOf(clientId);

      if (deficit >= DISPATCH_COST) {
        this.deficits.set(clientId, deficit - DISPATCH_COST);
        this.current = clientId;
        return clientId;
      }

      // Weight below one dispatch: carry the credit into the next round.
      this.deficits.set(clientId, deficit);
    }

    return null;
  }

  /**
   * Called when a client's queue turns out to be empty. Clearing the deficit is
   * what stops an idle client banking credit and bursting when it returns.
   */
  reset(clientId: string): void {
    this.deficits.delete(clientId);
    if (this.current === clientId) this.current = null;
  }

  /** Exposed for tests and the debug endpoint. */
  deficitOf(clientId: string): number {
    return this.deficits.get(clientId) ?? 0;
  }

  private nextStartIndex(clients: string[]): number {
    if (this.current === null) return 0;
    const index = clients.indexOf(this.current);
    // indexOf returns -1 when the current client disappeared, which lands on 0.
    return (index + 1) % clients.length;
  }
}
