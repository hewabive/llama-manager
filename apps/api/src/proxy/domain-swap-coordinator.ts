type Release = () => void;

export class DomainSwapCoordinator {
  private tails = new Map<string, Promise<void>>();

  async run<T>(domains: string[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(domains)].sort();
    const releases: Release[] = [];
    for (const key of keys) {
      const prior = this.tails.get(key) ?? Promise.resolve();
      let release!: Release;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.tails.set(key, held);
      await prior;
      releases.push(release);
    }
    try {
      return await fn();
    } finally {
      for (const release of releases) {
        release();
      }
    }
  }
}

export const domainSwapCoordinator = new DomainSwapCoordinator();
