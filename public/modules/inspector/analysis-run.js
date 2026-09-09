/** Mount-owned authority for an analysis. Abort is an optimization; identity is the commit guard. */
export function createAnalysisRun(signal, onChange = () => {}) {
  let current = null;
  let generation = 0;
  let state = 'idle';
  function transition(next) {
    state = next;
    onChange(state);
  }
  function invalidate() {
    if (current) current.abort.abort();
    current = null;
    generation += 1;
    transition('idle');
  }
  function isCurrent(run) {
    return !!run && current === run && !run.signal.aborted && !signal.aborted;
  }
  const controller = {
    start(snapshot) {
      invalidate();
      if (signal.aborted) return null;
      const abort = new AbortController();
      current = Object.freeze({
        id: generation,
        snapshot: Object.freeze({ ...snapshot }),
        abort,
        signal: abort.signal,
      });
      transition('pending');
      return current;
    },
    isCurrent,
    invalidate,
    finish(run, outcome = 'success') {
      if (!isCurrent(run)) return false;
      current = null;
      transition(outcome);
      return true;
    },
    get pending() {
      return current !== null;
    },
    get state() {
      return state;
    },
  };
  signal.addEventListener('abort', invalidate, { once: true });
  return controller;
}
