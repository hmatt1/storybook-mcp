import { chromium, Browser, BrowserContext, Page } from 'playwright';
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
 * Create a string representation of component state for use in filenames
 * @param {ComponentState} state - The component state
 * @returns {string} - String representation of the state
 */
function getStateString(state: ComponentState): string {
  if (!state || (!state.hover && !state.focus && !state.active)) {
    return 'Default';
  }
  
  const states = [];
  if (state.hover) states.push('Hover');
  if (state.focus) states.push('Focus');
  if (state.active) states.push('Active');
  
  return states.join('-');
}

/**
 * Detect Storybook version from the page
 * @param {Page} page - Playwright page object
 * @returns {Promise<number>} - Major version number (6, 7, or 8)
 */
async function detectStorybookVersion(page: Page): Promise<number> {
  try {
    // Try to detect version from the HTML
    const versionFromMeta = await page.evaluate(() => {
      const metaElement = document.querySelector('meta[name="storybook-version"]');
      return metaElement ? metaElement.getAttribute('content') : null;
    });
    
    if (versionFromMeta) {
      const majorVersion = parseInt(versionFromMeta.split('.')[0], 10);
      console.log(`Detected Storybook version ${versionFromMeta} from meta tag`);
      return majorVersion;
    }
    
    // Try to detect based on UI elements and API
    return await page.evaluate(() => {
      const win = window as any;
      
      // Storybook 8 specific elements
      if (document.querySelector('.sidebar-header--menu')) {
        return 8;
      }
      
      // Check for Storybook 8 API structure
      if (win.__STORYBOOK_STORY_STORE__?.storyIndex?.entries) {
        return 8;
      }
      
      // Check for Storybook 7 API structure
      if (win.__STORYBOOK_STORY_STORE__?.getStoriesJsonData) {
        return 7;
      }
      
      // Default to version 6 if we can't detect
      return 6;
    });
  } catch (error) {
    console.log('Error detecting Storybook version:', error);
    return 6; // Default to oldest supported version
  }
}

/**
 * Apply state to a component in the page (hover, focus, active)
 * @param {Page} page - Playwright page object
 * @param {ComponentState} state - Component state to apply
 * @param {number} sbVersion - Storybook version
 * @returns {Promise<void>}
 */
async function applyComponentState(page: Page, state: ComponentState, sbVersion: number): Promise<void> {
  // Create a serializable state object with just the boolean values
  const stateObj = {
    hover: state.hover || false,
    focus: state.focus || false,
    active: state.active || false
  };
  
  // Pass only the state object to the evaluate function
  await page.evaluate((serializedState) => {
    // Determine which selector to use based on what's available in the DOM
    // This adapts to different Storybook versions
    const version = parseInt((window as any).__STORYBOOK_VERSION || '6', 10);
    
    let root;
    if (version >= 8) {
      // Try different selectors for Storybook 8
      root = document.querySelector('#storybook-root > *, #root > *, [data-story-block="true"] > *');
    } else {
      // Older versions of Storybook
      root = document.querySelector('#storybook-root > *');
    }
    
    if (root) {
      if (serializedState.hover) {
        root.classList.add('sb-pseudo-hover');
      }
      if (serializedState.focus) {
        root.classList.add('sb-pseudo-focus');
      }
      if (serializedState.active) {
        root.classList.add('sb-pseudo-active');
      }
    } else {
      console.error('Root component element not found');
    }
  }, stateObj);
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
 *   state: { hover: true },
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
    
    // First, visit the main Storybook page to detect the version
    await page.goto(storybookUrl, { 
      timeout: 30000, 
      waitUntil: 'networkidle' 
    });
    
    const storybookVersion = await detectStorybookVersion(page);
    console.log(`Detected Storybook version ${storybookVersion}`);
    
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
    // The path format can vary by Storybook version
    let componentUrl;
    
    // For Storybook 7+ we use a slightly different URL format
    if (storybookVersion >= 7) {
      componentUrl = `${storybookUrl}?path=/story/${encodeURIComponent(storyId)}`;
    } else {
      // Legacy format for Storybook 6
      componentUrl = `${storybookUrl}?path=/story/${encodeURIComponent(storyId)}`;
    }
    
    console.log(`Navigating to: ${componentUrl}`);
    
    // Go to the URL and wait for navigation to complete with a generous timeout
    const response = await page.goto(componentUrl, { timeout: 30000, waitUntil: 'networkidle' });
    
    if (!response || response.status() >= 400) {
      throw new Error(`Failed to navigate to component (status: ${response?.status() || 'unknown'})`);
    }
    
    // Wait for the component to be fully rendered
    // In Storybook 8, the selector might be different
    await page.waitForSelector('#storybook-root, #storybook-preview-wrapper', { timeout: 10000 });
    
    // In Storybook 8, wait for "story rendered" indicator
    if (storybookVersion >= 8) {
      await page.waitForSelector('[data-story-rendered="true"]', { timeout: 5000 })
        .catch(() => console.log('Story rendered indicator not found, proceeding anyway'));
    }
    
    // Apply component state using the helper function
    await applyComponentState(page, state, storybookVersion);
    
    // Give the state a moment to take effect
    await page.waitForTimeout(100);
    
    // Take screenshot of the component
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    
    // Generate a unique filename based on component details and viewport
    const stateString = getStateString(state);
    const filename = `${storyId.replace(/\//g, '-')}-${stateString}.png`;
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
