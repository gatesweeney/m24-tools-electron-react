// indexer/worker/scheduler/queue.js
class ScanQueue {
  constructor({ concurrency = 4 } = {}) {
    this.concurrency = concurrency;
    this.running = new Map(); // volume_uuid -> job
    this.queue = [];
  }

  enqueue(job) {
    // avoid duplicates
    if (this.running.has(job.key) || this.queue.find(j => j.key === job.key)) {
      return;
    }
    this.queue.push(job);
    this.tick();
  }

  cancel(key) {
    // cancel running job
    const running = this.running.get(key);
    if (running) {
      running.cancel();
      this.running.delete(key);
    }

    // remove from queue
    this.queue = this.queue.filter(j => j.key !== key);
  }

  tick() {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.running.set(job.key, job);

      job.run()
        .catch(err => {
          console.error('[scanQueue] job error', job.key, err);
        })
        .finally(() => {
          this.running.delete(job.key);
          this.tick();
        });
    }
  }

  getCounts() {
    return { running: this.running.size, queued: this.queue.length };
  }

  getRunningKeys() {
    return Array.from(this.running.keys());
  }

  cancelCurrent() {
    const iterator = this.running.keys();
    const firstKey = iterator.next().value;
    if (!firstKey) {
      return null;
    }
    const job = this.running.get(firstKey);
    try {
      job.cancel();
    } catch {}
    this.running.delete(firstKey);
    return firstKey;
  }

  cancelAll() {
    // cancel running
    for (const [key, job] of this.running.entries()) {
      try { job.cancel(); } catch {}
      this.running.delete(key);
    }
    // clear queue
    this.queue = [];
  }
}

module.exports = { ScanQueue };