const config = require('./config');

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Missing X-API-Key header' });
  }
  const cfg = config.get();
  const keyEntry = cfg.api_keys.find(k => k.key === apiKey);
  if (!keyEntry) {
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }
  req.apiKeyName = keyEntry.name;
  next();
}

function adminAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Not authenticated' });
}

function adminLogin(req, res) {
  const { username, password } = req.body;
  const cfg = config.get();
  if (username === cfg.admin.username && password === cfg.admin.password) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
}

function adminLogout(req, res) {
  req.session = null;
  res.json({ success: true });
}

module.exports = { apiKeyAuth, adminAuth, adminLogin, adminLogout };
