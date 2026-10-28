'use strict';

// Keep slots occupied until the real operation settles, even if a caller leaves.
function createSearchQueue({ concurrency = 8, maxQueued = 256, waitMs = 10000 } = {}) {
  let active = 0;
  const queue = [];
  function start(entry) {
    clearTimeout(entry.timer);
    active++;
    Promise.resolve().then(entry.operation).then(entry.resolve, entry.reject).finally(() => {
      active--;
      if (queue.length) start(queue.shift());
    });
  }
  function busy() {
    return Object.assign(new Error('Search busy; please retry shortly'), { code: 'SEARCH_BUSY' });
  }
  return operation => new Promise((resolve, reject) => {
    const entry = { operation, resolve, reject };
    if (active < concurrency) return start(entry);
    if (queue.length >= maxQueued) return reject(busy());
    entry.timer = setTimeout(() => {
      const index = queue.indexOf(entry);
      if (index !== -1) { queue.splice(index, 1); reject(busy()); }
    }, waitMs);
    queue.push(entry);
  });
}
module.exports = { createSearchQueue };
