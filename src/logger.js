const MAX_LOGS = 100;
const logs = [];

function log(entry) {
  logs.unshift({
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (logs.length > MAX_LOGS) {
    logs.length = MAX_LOGS;
  }
}

function getLogs() {
  return logs;
}

function clear() {
  logs.length = 0;
}

module.exports = { log, getLogs, clear };
