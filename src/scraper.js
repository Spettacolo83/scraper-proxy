const { chromium } = require('playwright');
const config = require('./config');

let browser = null;

async function launch() {
  const cfg = config.get().browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  console.log('Browser launched');
  browser.on('disconnected', () => {
    console.log('Browser disconnected, relaunching...');
    browser = null;
    setTimeout(launch, 1000);
  });
}

async function fetchPage(url, format = 'html') {
  if (!browser) {
    await launch();
  }

  const cfg = config.get().browser;
  const context = await browser.newContext({
    userAgent: cfg.user_agent,
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();
  const startTime = Date.now();

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: cfg.timeout_ms
    });

    await page.waitForTimeout(cfg.wait_after_load_ms);

    const statusCode = response ? response.status() : 0;
    let content;

    if (format === 'text') {
      content = await page.innerText('body');
    } else {
      content = await page.content();
    }

    const elapsed = Date.now() - startTime;

    return {
      success: true,
      url,
      [format === 'text' ? 'text' : 'html']: content,
      status_code: statusCode,
      elapsed_ms: elapsed
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    return {
      success: false,
      url,
      error: error.message,
      elapsed_ms: elapsed
    };
  } finally {
    await context.close();
  }
}

async function close() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { launch, fetchPage, close };
