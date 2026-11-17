export class BackgroundCanceled extends Error {
  constructor() { super('Черновик изменён или задача отменена'); this.backgroundCanceled = true; }
}

export function createKeyedExecutor() {
  const tails = new Map();
  return {
    run(key, action) {
      const result = (tails.get(key) || Promise.resolve()).catch(() => {}).then(action);
      const settled = result.catch(() => {});
      tails.set(key, settled);
      settled.finally(() => { if (tails.get(key) === settled) tails.delete(key); });
      return result;
    }
  };
}

// One expensive preparation at a time; callers never await its completion.
export function createBackgroundQueue() {
  const latest = new Map();
  let tail = Promise.resolve();
  return {
    hasCurrent(key, identity, revision) {
      const job = latest.get(key);
      return Boolean(job && !job.committed && job.spec.identity === identity && job.spec.revision === revision && job.spec.isCurrent());
    },
    start(key, spec) {
      const previous = latest.get(key);
      if (previous && !previous.committed && previous.spec.identity === spec.identity && previous.spec.revision === spec.revision &&
        (previous.spec.variant === spec.variant || spec.after) && previous.spec.isCurrent()) {
        if (spec.after) previous.after = spec.after;
        return { reused: true, done: previous.done };
      }
      const job = { spec, after: spec.after, committed: false };
      latest.set(key, job);
      const control = {
        assertCurrent() {
          if (latest.get(key) !== job || !spec.isCurrent()) throw new BackgroundCanceled();
        },
        commit() { job.committed = true; },
        hasAfter() { return Boolean(job.after); },
        after() { return job.after?.(); }
      };
      job.done = tail.catch(() => {}).then(async () => {
        try {
          control.assertCurrent();
          const value = await spec.work(control);
          control.assertCurrent();
          await spec.finish(value, control);
        } catch (error) {
          if (!job.committed) await Promise.resolve().then(() => spec.dispose?.()).catch(() => {});
          if (!error.backgroundCanceled && spec.isCurrent() && latest.get(key) === job) await spec.onError?.(error);
        } finally {
          if (latest.get(key) === job) latest.delete(key);
        }
      }).catch(error => { console.error('Фоновая подготовка:', error); });
      tail = job.done;
      return { reused: false, done: job.done };
    }
  };
}
