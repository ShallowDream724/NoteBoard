/** Coalesce typing without starving statistics during continuous input. All callbacks are cancelled on disposal. */
export function createStatisticsScheduler(run: () => void, delay = 120, maximumDelay = 500) {
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let maximum: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const cancel = () => { clearTimeout(trailing); clearTimeout(maximum); trailing = maximum = undefined; };
  const flush = () => { cancel(); if (!disposed) run(); };
  return {
    schedule() {
      if (disposed) return;
      clearTimeout(trailing); trailing = setTimeout(flush, delay);
      maximum ??= setTimeout(flush, maximumDelay);
    },
    dispose() { disposed = true; cancel(); },
  };
}
