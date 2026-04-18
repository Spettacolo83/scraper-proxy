const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const config = require('./config');
const scraper = require('./scraper');
const { apiKeyAuth, adminAuth, adminLogin, adminLogout } = require('./auth');
const rateLimiter = require('./rate-limiter');
const logger = require('./logger');

config.load();

const app = express();
app.use(express.json());

app.use(cookieSession({
  name: 'scraper-admin',
  keys: [crypto.randomBytes(32).toString('hex')],
  maxAge: 24 * 60 * 60 * 1000
}));

// Redirect / to admin dashboard
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.redirect('/admin/admin.html'));
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  const cfg = config.get();
  res.json({
    status: 'ok',
    stats: rateLimiter.getStats(),
    residential_proxy: cfg.residential_proxy || null
  });
});

// Forward request to residential proxy (Mac via Tailscale)
function fetchViaResidential(residentialUrl, targetUrl) {
  return new Promise((resolve, reject) => {
    const encodedUrl = encodeURIComponent(targetUrl);
    const reqUrl = `${residentialUrl}/fetch?url=${encodedUrl}`;

    // In Tailscale userspace mode, use SOCKS5 proxy to reach tailnet IPs
    const opts = { timeout: 60000 };
    const socksProxy = process.env.TAILSCALE_SOCKS5 || 'socks5://localhost:1055';
    try {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      opts.agent = new SocksProxyAgent(socksProxy);
      console.log(`Using SOCKS5 proxy (${socksProxy}) for: ${reqUrl}`);
    } catch (e) {
      console.log(`SOCKS5 agent error: ${e.message}, trying direct connection`);
    }

    const req = http.get(reqUrl, opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON from residential proxy'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Residential proxy timeout')); });
  });
}

function needsResidentialProxy(url) {
  const cfg = config.get();
  const rp = cfg.residential_proxy;
  if (!rp || !rp.enabled || !rp.domains || !rp.url) return false;

  const hostname = new URL(url).hostname;
  return rp.domains.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );
}

app.get('/fetch', apiKeyAuth, async (req, res) => {
  const url = req.query.url;
  const format = req.query.format || 'html';

  if (!url) {
    return res.status(400).json({ success: false, error: 'Missing url parameter' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }

  const cfg = config.get();
  if (cfg.whitelist.length > 0) {
    const hostname = new URL(url).hostname;
    const allowed = cfg.whitelist.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
    if (!allowed) {
      return res.status(403).json({ success: false, error: `Domain ${hostname} not in whitelist` });
    }
  }

  const check = rateLimiter.canProceed();
  if (!check.allowed) {
    logger.log({ url, api_key: req.apiKeyName, status: 429, elapsed_ms: 0 });
    return res.status(429).json({ success: false, error: check.reason });
  }

  rateLimiter.acquire();
  try {
    let result;

    if (needsResidentialProxy(url)) {
      // Route through Mac residential proxy via Tailscale
      const rp = cfg.residential_proxy;
      console.log(`Routing via residential proxy: ${url}`);
      try {
        result = await fetchViaResidential(rp.url, url);
      } catch (err) {
        // Fallback to local scraper if residential proxy is down
        console.log(`Residential proxy failed (${err.message}), falling back to local`);
        result = await scraper.fetchPage(url, format);
      }
    } else {
      // Use local Playwright
      result = await scraper.fetchPage(url, format);
    }

    logger.log({
      url,
      api_key: req.apiKeyName,
      status: result.success ? result.status_code : 'error',
      elapsed_ms: result.elapsed_ms,
      via: needsResidentialProxy(url) ? 'residential' : 'local'
    });
    res.json(result);
  } catch (error) {
    logger.log({ url, api_key: req.apiKeyName, status: 'error', elapsed_ms: 0 });
    res.status(500).json({ success: false, error: error.message });
  } finally {
    rateLimiter.release();
  }
});

app.post('/admin/login', adminLogin);
app.post('/admin/logout', adminLogout);

app.get('/admin/api/config', adminAuth, (req, res) => {
  const cfg = { ...config.get() };
  cfg.admin = { ...cfg.admin, password: '********' };
  res.json(cfg);
});

app.put('/admin/api/config', adminAuth, (req, res) => {
  const current = config.get();
  const updates = req.body;

  if (updates.admin) {
    if (updates.admin.password === '********') {
      updates.admin.password = current.admin.password;
    }
  }

  const updated = config.update(updates);
  const safe = { ...updated };
  safe.admin = { ...safe.admin, password: '********' };
  res.json(safe);
});

app.get('/admin/api/logs', adminAuth, (req, res) => {
  res.json(logger.getLogs());
});

const PORT = process.env.PORT || 3000;

async function start() {
  await scraper.launch();
  app.listen(PORT, () => {
    console.log(`Scraper proxy running on port ${PORT}`);
    const cfg = config.get();
    if (cfg.residential_proxy && cfg.residential_proxy.enabled) {
      console.log(`Residential proxy: ${cfg.residential_proxy.url} (${cfg.residential_proxy.domains.length} domains)`);
    }
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await scraper.close();
  process.exit(0);
});
