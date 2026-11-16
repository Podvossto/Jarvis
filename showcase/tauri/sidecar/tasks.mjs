// The parallel-task queue: a new request while one is running waits in line instead of cancelling it. An explicit
// stop clears the line; the list is what the overlay shows. The running job is the sidekick's business (its abort
// controller); this only holds the ones waiting.
const MAX = 3;
let seq = 0;

/** FIFO of pending requests. add returns the id, or null when the queue is full (the caller tells the user);
 *  take hands out the oldest and leaves the list; cancelAll drops everything waiting and returns it. */
export function createTasks({ max = MAX } = {}) {
  const jobs = [];
  return {
    add(text, meta = {}) {
      if (jobs.length >= max) return null;
      const job = { id: ++seq, text, state: 'queued', byVoice: !!meta.byVoice, image: meta.image ?? null, note: meta.note ?? '', listenAfter: !!meta.listenAfter, news: meta.news ?? null };
      jobs.push(job);
      return job.id;
    },
    take() { return jobs.shift() ?? null; },
    cancelAll() { return jobs.splice(0); },
    list() { return jobs.map((j) => ({ id: j.id, text: j.text, state: j.state, byVoice: j.byVoice })); },
    get size() { return jobs.length; },
  };
}
