// indexer/worker/scan/util/throttle.js
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeYield(counter, { every = 500, ms = 10 } = {}) {
  if (counter % every === 0) {
    await sleep(ms);
  }
}

module.exports = { sleep, maybeYield };