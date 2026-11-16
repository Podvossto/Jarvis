// The clock widget's countdown, kept in the sidecar so it fires even while the model is busy: one active timer,
// a new one replaces the old (the old comes back as {cancelled} so its timeout can be cleared), and fire() reports
// the label when its time has passed. The overlay only ever gets endsAt and draws the rest.
export function createClock({ now = Date.now } = {}) {
  let timer = null;
  return {
    active() {
      return timer ? { ...timer, leftMs: (at) => Math.max(0, timer.endsAt - at) } : null;
    },
    start({ minutes = 0, seconds = 0, label = 'the timer' } = {}) {
      const ms = Math.round(minutes * 60_000 + seconds * 1000);
      const old = timer ? { ...timer, cancelled: true } : null;
      timer = { endsAt: now() + ms, label: String(label).slice(0, 60), ms };
      return { endsAt: timer.endsAt, label: timer.label, cancelled: old };
    },
    cancel() {
      const old = timer;
      timer = null;
      return old;
    },
    /** {label} when the countdown has passed (the caller then announces it), {fired: false} while still waiting,
     *  null when nothing runs. */
    fire(at = now()) {
      if (!timer) return null;
      if (at < timer.endsAt) return { fired: false };
      const done = { label: timer.label };
      timer = null;
      return done;
    },
  };
}
