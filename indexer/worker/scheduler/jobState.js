// indexer/worker/scheduler/jobState.js
function createCancelToken() {
  let cancelled = false;
  return {
    get cancelled() { return cancelled; },
    cancel() { cancelled = true; }
  };
}

module.exports = { createCancelToken };