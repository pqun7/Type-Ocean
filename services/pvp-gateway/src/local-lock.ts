export type LocalLock = {
  runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;
};

export function createLocalLock(): LocalLock {
  let tail = Promise.resolve();

  return {
    async runExclusive<T>(fn: () => Promise<T> | T) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });

      await previous;
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}