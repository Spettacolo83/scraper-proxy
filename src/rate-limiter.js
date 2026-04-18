const config = require('./config');

const requestTimestamps = [];
let activeRequests = 0;
const queue = [];

function cleanup() {
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60000) {
    requestTimestamps.shift();
  }
}

function canProceed() {
  const cfg = config.get().rate_limit;
  cleanup();
  if (requestTimestamps.length >= cfg.max_requests_per_minute) {
    return { allowed: false, reason: 'Rate limit exceeded (max per minute)' };
  }
  if (activeRequests >= cfg.max_concurrent) {
    return { allowed: false, reason: 'Max concurrent requests reached' };
  }
  return { allowed: true };
}

function acquire() {
  requestTimestamps.push(Date.now());
  activeRequests++;
}

function release() {
  activeRequests--;
  processQueue();
}

function enqueue(resolve, reject) {
  if (queue.length >= 10) {
    reject(new Error('Queue full'));
    return;
  }
  queue.push({ resolve, reject });
}

function processQueue() {
  if (queue.length === 0) return;
  const check = canProceed();
  if (check.allowed) {
    const { resolve } = queue.shift();
    acquire();
    resolve();
  }
}

function getStats() {
  cleanup();
  return {
    requests_last_minute: requestTimestamps.length,
    active_requests: activeRequests,
    queued: queue.length
  };
}

module.exports = { canProceed, acquire, release, enqueue, getStats };
