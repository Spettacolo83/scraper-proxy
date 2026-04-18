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

    // Wait for Cloudflare challenge to resolve
    // Strategy: wait for the "Just a moment" title to disappear,
    // or fall back to fixed wait if no Cloudflare challenge detected
    try {
      const title = await page.title();
      if (title.includes('Just a moment') || title.includes('Checking')) {
        // Cloudflare detected — wait up to 15 seconds for it to resolve
        await page.waitForFunction(
          () => !document.title.includes('Just a moment') && !document.title.includes('Checking'),
          { timeout: 15000 }
        );
        // Extra wait after challenge resolves for page to fully load
        await page.waitForTimeout(2000);
      } else {
        // No Cloudflare, just wait the configured time
        await page.waitForTimeout(cfg.wait_after_load_ms);
      }
    } catch {
      // Cloudflare challenge didn't resolve in time, continue with what we have
      await page.waitForTimeout(cfg.wait_after_load_ms);
    }

    const statusCode = response ? response.status() : 0;
    // Get final status after potential redirects
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
