/**
 * Just enough Redis to exercise the sorted-set logic in RateLimiter without a
 * server. Commands are executed eagerly and `multi()` simply records them, which
 * is faithful enough because these tests are single-threaded.
 */
export class FakeRedis {
  private readonly sets = new Map<string, Map<string, number>>();

  zadd(key: string, score: number, member: string): number {
    const set = this.setFor(key);
    const isNew = !set.has(member);
    set.set(member, score);
    return isNew ? 1 : 0;
  }

  zcard(key: string): number {
    return this.setFor(key).size;
  }

  zrem(key: string, member: string): number {
    return this.setFor(key).delete(member) ? 1 : 0;
  }

  zremrangebyscore(key: string, min: number, max: number): number {
    const set = this.setFor(key);
    let removed = 0;
    for (const [member, score] of set) {
      if (score >= min && score <= max) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  zrange(key: string, start: string, stop: string, withScores?: string): string[] {
    const sorted = [...this.setFor(key).entries()].sort((a, b) => a[1] - b[1]);
    const from = Number(start);
    const to = Number(stop) < 0 ? sorted.length + Number(stop) : Number(stop);
    const slice = sorted.slice(from, to + 1);

    return withScores === undefined
      ? slice.map(([member]) => member)
      : slice.flatMap(([member, score]) => [member, String(score)]);
  }

  pexpire(): number {
    // TTLs do not affect any assertion here; the window is enforced by score.
    return 1;
  }

  multi() {
    const results: Array<[null, unknown]> = [];
    const chain = {
      zremrangebyscore: (key: string, min: number, max: number) => {
        results.push([null, this.zremrangebyscore(key, min, max)]);
        return chain;
      },
      zcard: (key: string) => {
        results.push([null, this.zcard(key)]);
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        results.push([null, this.zadd(key, score, member)]);
        return chain;
      },
      pexpire: () => {
        results.push([null, this.pexpire()]);
        return chain;
      },
      exec: async () => results,
    };
    return chain;
  }

  private setFor(key: string): Map<string, number> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Map();
      this.sets.set(key, set);
    }
    return set;
  }
}
