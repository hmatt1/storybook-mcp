import { chromium, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as url from 'url';
import { CaptureOptions, CaptureResult, ComponentState } from './types.js';

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
 * @private
 */
async function getBrowser(): Promise<{ browser: Browser, context: BrowserContext }> {
  if (!browserInstance) {
    browserInstance = await chromium.launch();
    browserContext = await browserInstance.newContext();
  }
  
  return { 
    browser: browserInstance, 
    context: browserContext as BrowserContext 
  };
}

/**
 * Prepare a string for use in a Storybook URL
 * @param {string} str - The string to prepare
 * @returns {string} - A URL-safe string for Storybook
 */
function prepareForStorybookUrl(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .trim();
}

/**
 * Capture a screenshot of a Storybook component
 * 
 * This function navigates to a specific component in Storybook, applies
 * the requested state (hover, focus, etc.), and captures a screenshot
 * at the specified viewport size.
 * 
 * @param {CaptureOptions} options - Options for capturing the screenshot
 * @returns {Promise<CaptureResult>} Result with screenshot details
 * @throws {Error} If unable to navigate to component or capture screenshot
 * 
 * @example
 * ```ts
 * const result = await captureComponent({
 *   component: 'button--primary',
 *   variant: 'Default',
 *   state: 'hover',
 *   viewport: { width: 375, height: 667 },
 *   storybookUrl: 'http://localhost:6006',
 *   outputDir: './screenshots'
 * });
 * console.log(`Screenshot saved to ${result.screenshotPath}`);
 * ```
 */
export async function captureComponent(options: CaptureOptions): Promise<CaptureResult> {
  const { component, variant, state, viewport, storybookUrl, outputDir } = options;
  
  const { context } = await getBrowser();
  const page = await context.newPage();
  
  try {
    // Set viewport dimensions for responsive testing
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height
    });
    
    // Process the component ID to extract the base ID without the variant
    // Format is usually "componentname--variantname"
    let componentId = component;
    let storyId;
    
    // If component already includes a variant (contains --), we need to handle it correctly
    if (component.includes('--')) {
      // Use the component ID as is
      storyId = component;
    } else {
      // Format the variant name for Storybook URL
      const formattedVariant = prepareForStorybookUrl(variant);
      storyId = `${component}--${formattedVariant}`;
    }
    
    // Construct URL for specific component and variant
    // The format is: storybookUrl?path=/story/{storyId}
    const componentUrl = `${storybookUrl}?path=/story/${encodeURIComponent(storyId)}`;
    console.log(`Navigating to: ${componentUrl}`);
    
    // Go to the URL and wait for navigation to complete with a generous timeout
    const response = await page.goto(componentUrl, { timeout: 30000, waitUntil: 'networkidle' });
    
    if (!response || response.status() >= 400) {
      throw new Error(`Failed to navigate to component (status: ${response?.status() || 'unknown'})`);
    }
    
    // Wait for the component to be fully rendered
    await page.waitForSelector('#storybook-root', { timeout: 10000 });
    
    // Apply component state (hover, focus, etc.) by adding appropriate classes
    // Storybook uses special classes (sb-pseudo-*) to simulate different states
    if (state !== 'default') {
      await page.evaluate((stateName: string) => {
        const root = document.querySelector('#storybook-root > *');
        if (root) {
          switch (stateName) {
            case 'hover':
              root.classList.add('sb-pseudo-hover');
              break;
            case 'focus':
              root.classList.add('sb-pseudo-focus');
              break;
            case 'active':
              root.classList.add('sb-pseudo-active');
              break;
          }
        }
      }, state);
      
      // Give the state a moment to take effect
      await page.waitForTimeout(100);
    }
    
    // Take screenshot of the component
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    
    // Generate a unique filename based on component details and viewport
    const filename = `${storyId.replace(/\//g, '-')}_${state}_${viewport.width}x${viewport.height}.png`;
    const filePath = path.join(outputDir, filename);
    
    // Save screenshot to disk
    await fs.writeFile(filePath, screenshot);
    
    // For MCP context, we use the file:// protocol to reference the screenshot
    const fileUrl = url.pathToFileURL(filePath).href;
    
    return {
      component,
      variant,
      state,
      viewport,
      screenshotUrl: fileUrl,
      screenshotPath: filePath
    };
  } catch (error) {
    console.error('Error capturing component:', error);
    throw error;
  } finally {
    // Release page resources
    await page.close();
  }
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
