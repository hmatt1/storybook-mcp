import { Browser, BrowserContext, chromium } from 'playwright';

// Store browser instance globally so we can reuse it
let browserInstance: Browser | null = null;
let browserContext: BrowserContext | null = null;

/**
 * Initialize or return existing browser instance
 *
 * This function lazily initializes a browser instance that can be reused
 * across multiple screenshot operations for better performance.
 *
 * @returns {Promise<{browser: Browser, context: BrowserContext}>} Browser and context instances
 */
export async function getBrowser(): Promise<{ browser: Browser, context: BrowserContext }> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    browserContext = await browserInstance.newContext();
  }

  return {
    browser: browserInstance,
    context: browserContext as BrowserContext
  };
}

/**
 * Close browser instance and clean up resources
 *
 * This function should be called during application shutdown
 * to properly release all browser resources.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    browserContext = null;
  }
}

// Handle process exit to clean up browser resources automatically
process.on('exit', () => {
  if (browserInstance) {
    browserInstance.close().catch(console.error);
  }
});
