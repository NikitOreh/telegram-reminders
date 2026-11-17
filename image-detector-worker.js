const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

// One request at a time: OpenCV's network is mutable and must not run concurrently.
export function createImageDetectorWorker({ spawnWorker, timeoutMs = 30_000 }) {
  let current = null;
  let closed = false;
  let tail = Promise.resolve();

  function references(state, active) {
    for (const handle of [state.child, state.child.stdin, state.child.stdout, state.child.stderr]) {
      handle?.[active ? 'ref' : 'unref']?.();
    }
  }

  function stop(state, reason) {
    if (current === state) current = null;
    const pending = state.pending;
    state.pending = null;
    clearTimeout(pending?.timer);
    state.child.kill();
    state.child.stdin.destroy();
    state.child.stdout.destroy();
    state.child.stderr.destroy();
    references(state, false);
    pending?.reject(new Error(`Локальный детектор людей недоступен: ${reason}`));
  }

  async function execute(image) {
    if (closed) throw new Error('Детектор людей остановлен');
    if (!Buffer.isBuffer(image) || !image.length || image.length > MAX_IMAGE_BYTES) {
      throw new Error('Недопустимый размер изображения для детектора людей');
    }
    if (!current) {
      const child = await spawnWorker();
      const state = { child, pending: null, output: '', stderr: '' };
      current = state;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-4096); });
      child.stdout.on('data', chunk => {
        if (current !== state) return;
        state.output += chunk;
        if (state.output.length > 32 || !state.pending) return stop(state, 'неверный ответ процесса');
        if (!state.output.includes('\n')) return;
        if (!/^(PASS|REJECT)\r?\n$/.test(state.output)) return stop(state, 'неверный ответ процесса');
        const pending = state.pending;
        state.pending = null;
        clearTimeout(pending.timer);
        const result = state.output.startsWith('PASS');
        state.output = '';
        references(state, false);
        pending.resolve(result);
      });
      child.on('error', error => stop(state, error.message));
      child.stdin.on('error', error => stop(state, error.message));
      child.on('close', code => {
        if (current === state) stop(state, state.stderr.trim() || `код ${code}`);
      });
      if (closed) {
        stop(state, 'процесс остановлен');
        throw new Error('Детектор людей остановлен');
      }
    }
    const state = current;
    references(state, true);
    return new Promise((resolve, reject) => {
      state.pending = { resolve, reject, timer: setTimeout(() => stop(state, 'время проверки истекло'), timeoutMs) };
      const header = Buffer.alloc(4);
      header.writeUInt32BE(image.length);
      try { state.child.stdin.write(Buffer.concat([header, image])); }
      catch (error) { stop(state, error.message); }
    });
  }

  return {
    run(image) {
      const result = tail.then(() => execute(image));
      tail = result.catch(() => {});
      return result;
    },
    close() {
      closed = true;
      if (current) stop(current, 'процесс остановлен');
    }
  };
}
