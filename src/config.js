const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.default.json');

let config = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
    fs.writeFileSync(CONFIG_PATH, defaultConfig);
  }
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config;
}

function get() {
  if (!config) load();
  return config;
}

function save(newConfig) {
  ensureDataDir();
  config = newConfig;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function update(partial) {
  const current = get();
  const updated = { ...current, ...partial };
  save(updated);
  return updated;
}

module.exports = { load, get, save, update };
