const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

// Apply stealth plugin to bypass bot detection
chromium.use(stealth());

let browser = null;

async function launch() {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  console.log('Browser launched (with stealth)');
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
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Europe/Madrid'
  });

  const page = await context.newPage();
  const startTime = Date.now();

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: cfg.timeout_ms
    });

    // Wait for Cloudflare challenge to resolve
    try {
      const title = await page.title();
      if (title.includes('Just a moment') || title.includes('Checking')) {
        console.log(`Cloudflare detected for ${url}, waiting up to 20s...`);
        await page.waitForFunction(
          () => !document.title.includes('Just a moment') && !document.title.includes('Checking'),
          { timeout: 20000 }
        );
        // Extra wait after challenge resolves
        await page.waitForTimeout(3000);
        console.log(`Cloudflare resolved for ${url}`);
      } else {
        await page.waitForTimeout(cfg.wait_after_load_ms);
      }
    } catch {
      console.log(`Cloudflare challenge did not resolve for ${url}`);
      await page.waitForTimeout(cfg.wait_after_load_ms);
    }

    const statusCode = response ? response.status() : 0;
    const finalUrl = page.url();
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
      final_url: finalUrl,
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
