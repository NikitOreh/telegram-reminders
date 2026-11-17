// Bound downloads AND buffered results; consumers still validate one image at a time.
export async function* orderedPrefetch(items, download, { concurrency = 3, checkActive } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid download concurrency');
  const controller = new AbortController();
  const pending = [];
  const iterator = items[Symbol.iterator]();
  let exhausted = false;
  function fill() {
    while (!exhausted && pending.length < concurrency) {
      checkActive?.();
      const next = iterator.next();
      if (next.done) { exhausted = true; break; }
      const item = next.value;
      // Capture failures immediately, including results never consumed after early return.
      pending.push(Promise.resolve().then(() => {
        checkActive?.();
        controller.signal.throwIfAborted();
        return download(item, controller.signal);
      }).then(value => ({ item, value, ok: true }), error => ({ item, error, ok: false })));
    }
  }
  try {
    fill();
    while (pending.length) {
      const result = await pending.shift();
      checkActive?.();
      yield result;
      fill();
    }
  } finally {
    controller.abort();
    iterator.return?.();
  }
}
