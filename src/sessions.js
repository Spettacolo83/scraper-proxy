const { firefox } = require('playwright');
const config = require('./config');

const sessions = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function getBrowser() {
  const browser = await firefox.launch({
    headless: true,
    args: []
  });
  return browser;
}

async function create(options = {}) {
  const id = 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const cfg = config.get().browser || {};

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: cfg.user_agent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Europe/Madrid'
  });
  const page = await context.newPage();

  const session = {
    id,
    browser,
    context,
    page,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    useResidential: options.use_residential || false
  };

  sessions.set(id, session);
  scheduleTimeout(id);

  console.log(`Session created: ${id}`);
  return { session_id: id, created: true };
}

function scheduleTimeout(id) {
  const session = sessions.get(id);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => close(id), SESSION_TIMEOUT);
}

function touch(id) {
  const session = sessions.get(id);
  if (session) {
    session.lastActivity = Date.now();
    scheduleTimeout(id);
  }
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error(`Session ${id} not found`);
  touch(id);
  return session;
}

async function goto(id, url) {
  const { page } = getSession(id);
  const cfg = config.get().browser || {};

  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: cfg.timeout_ms || 45000
  });

  // Handle Cloudflare
  try {
    const title = await page.title();
    if (title.includes('Just a moment') || title.includes('Checking') || title.includes('Attention')) {
      console.log(`Session ${id}: Cloudflare detected, waiting...`);
      await page.waitForFunction(
        () => {
          const t = document.title.toLowerCase();
          return !t.includes('just a moment') && !t.includes('checking') && !t.includes('attention');
        },
        { timeout: 25000 }
      );
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(cfg.wait_after_load_ms || 2000);
    }
  } catch {
    await page.waitForTimeout(2000);
  }

  return {
    success: true,
    title: await page.title(),
    url: page.url(),
    status_code: response ? response.status() : 0
  };
}

async function content(id, format = 'html') {
  const { page } = getSession(id);
  let result;
  if (format === 'text') {
    result = await page.innerText('body');
  } else {
    result = await page.content();
  }
  return { success: true, content: result, url: page.url() };
}

async function fill(id, { selector, label, value }) {
  const { page } = getSession(id);
  try {
    if (selector) {
      await page.fill(selector, value);
    } else if (label) {
      await page.getByLabel(label).fill(value);
    }
    return { success: true };
  } catch (e) {
    try {
      if (label) {
        await page.locator(`[placeholder*="${label}" i]`).fill(value);
        return { success: true };
      }
    } catch {}
    return { success: false, error: e.message };
  }
}

async function click(id, { selector, text }) {
  const { page } = getSession(id);
  const urlBefore = page.url();
  try {
    if (selector) {
      await page.click(selector, { timeout: 10000 });
    } else if (text) {
      await page.getByRole('button', { name: text }).or(
        page.getByRole('link', { name: text })
      ).or(
        page.locator(`text="${text}"`)
      ).first().click({ timeout: 10000 });
    }
    await page.waitForTimeout(2000);
    return {
      success: true,
      navigation: page.url() !== urlBefore,
      new_url: page.url()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function selectOption(id, { selector, label, value }) {
  const { page } = getSession(id);
  try {
    if (selector) {
      await page.selectOption(selector, value);
    } else if (label) {
      await page.getByLabel(label).selectOption(value);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function upload(id, { selector, label, file_path }) {
  const { page } = getSession(id);
  try {
    let locator;
    if (selector) {
      locator = page.locator(selector);
    } else if (label) {
      locator = page.getByLabel(label);
    } else {
      locator = page.locator('input[type="file"]').first();
    }
    await locator.setInputFiles(file_path);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function screenshot(id) {
  const { page } = getSession(id);
  const buffer = await page.screenshot({ fullPage: false });
  return { success: true, image_base64: buffer.toString('base64') };
}

async function close(id) {
  const session = sessions.get(id);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.timer) clearTimeout(session.timer);
  try {
    await session.context.close();
    await session.browser.close();
  } catch {}
  sessions.delete(id);
  console.log(`Session closed: ${id}`);
  return { success: true };
}

function listSessions() {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    created: new Date(s.createdAt).toISOString(),
    lastActivity: new Date(s.lastActivity).toISOString(),
    url: s.page.url(),
    useResidential: s.useResidential
  }));
}

module.exports = { create, goto, content, fill, click, selectOption, upload, screenshot, close, listSessions };
