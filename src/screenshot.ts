import { chromium, Browser, BrowserContext, Page, ElementHandle } from 'playwright';
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
    return 'default';
  }

  const states = [];
  if (state.hover) states.push('hover');
  if (state.focus) states.push('focus');
  if (state.active) states.push('active');

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
      console.error(`Detected Storybook version ${versionFromMeta} from meta tag`);
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
      return 6; // Default to oldest supported version
    });
  } catch (error) {
    console.error('Error detecting Storybook version:', error);
    return 6; // Default to oldest supported version
  }
}

/**
 * Wait for the iframe to load (Storybook 7+)
 * @param {Page} page - Playwright page object
 * @returns {Promise<void>}
 */
async function waitForIframeLoad(page: Page): Promise<void> {
  try {
    // First look for iframe - this is especially important for SB 7+
    const iframe = await page.waitForSelector(
        'iframe[id="storybook-preview-iframe"]',
        { timeout: 10000 }
    ).catch(() => null);

    if (iframe) {
      console.error('Found preview iframe, waiting for it to load');
      // Wait for iframe content to be available
      const frameHandle = await iframe.contentFrame();
      if (frameHandle) {
        // Wait for component rendering to complete inside the iframe
        await frameHandle.waitForSelector(
            '#storybook-root > *, #root > *, [data-story-block="true"] > *',
            { timeout: 10000 }
        );
        console.error('Iframe content loaded and component found');
      }
    } else {
      console.error('No iframe found, assuming direct rendering');
    }
  } catch (error) {
    console.error('Error waiting for iframe load:', error);
    // Continue even if we have an error - we'll try to find the component directly
  }
}

/**
 * Apply state to a component in the page (hover, focus, active)
 * @param {Page} page - Playwright page object
 * @param {ComponentState} state - Component state to apply
 * @returns {Promise<void>}
 */
async function applyComponentState(page: Page, state: ComponentState): Promise<void> {
  if (!state || (!state.hover && !state.focus && !state.active)) {
    return; // No state to apply
  }

  try {
    // First try to find the component in an iframe (for Storybook 7+)
    const iframe = await page.$(
        'iframe[id="storybook-preview-iframe"]'
    );

    if (iframe) {
      const frame = await iframe.contentFrame();
      if (frame) {
        await applyStateToFrame(frame, state);
        return;
      }
    }

    // If no iframe or frame could not be obtained, try applying directly to the page
    await applyStateToFrame(page, state);
  } catch (error) {
    console.error('Error applying component state:', error);
  }
}

/**
 * Apply state to a component within a frame or page
 * @param {Page|Frame} frameOrPage - Playwright page or frame object
 * @param {ComponentState} state - Component state to apply
 * @returns {Promise<void>}
 */
async function applyStateToFrame(frameOrPage: any, state: ComponentState): Promise<void> {
  // Create a serializable state object with just the boolean values
  const stateObj = {
    hover: state.hover || false,
    focus: state.focus || false,
    active: state.active || false
  };

  await frameOrPage.evaluate((serializedState) => {
    // Find the component root
    const componentElement = document.querySelector(
        '#storybook-root > *, #root > *, [data-story-block="true"] > *, .sb-story > *'
    );

    if (!componentElement) {
      console.error('Component element not found');
      return;
    }

    // Apply state classes
    if (serializedState.hover) {
      componentElement.classList.add('sb-pseudo-hover');
    }
    if (serializedState.focus) {
      componentElement.classList.add('sb-pseudo-focus');
      // Also try to focus the element
      (componentElement as HTMLElement).focus();
    }
    if (serializedState.active) {
      componentElement.classList.add('sb-pseudo-active');
    }

    // For interactive components, we should also apply actual DOM events
    if (serializedState.hover) {
      componentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      componentElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
    if (serializedState.active) {
      componentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  }, stateObj);

  // If hover state is requested, also use Playwright's hover method
  if (state.hover) {
    const component = await frameOrPage.$(
        '#storybook-root > *, #root > *, [data-story-block="true"] > *, .sb-story > *'
    );
    if (component) {
      await component.hover();
    }
  }

  // Small delay to allow state to take effect visually
  await frameOrPage.waitForTimeout(300);
}

/**
 * Find and get the component element in the page
 * @param {Page} page - Playwright page object
 * @returns {Promise<ElementHandle|null>} - The component element or null
 */
async function findComponentElement(page: Page): Promise<ElementHandle | null> {
  try {
    // First check if we have an iframe
    const iframe = await page.$('iframe[id="storybook-preview-iframe"]');

    if (iframe) {
      const frame = await iframe.contentFrame();
      if (!frame) return null;

      // Try multiple selectors to find the component
      const selectors = [
        '#storybook-root > *:not(style):not(script)',
        '#root > *:not(style):not(script)',
        '[data-story-block="true"] > *:not(style):not(script)',
        '.sb-story > *:not(style):not(script)',
        '.sb-main > *:not(style):not(script)'
      ];

      for (const selector of selectors) {
        const component = await frame.$(selector);
        if (component) {
          console.error(`Found component in iframe with selector: ${selector}`);
          return component;
        }
      }

      console.error('No component found in iframe with any selector');
      return null;
    }

    // If no iframe, try direct selectors on the page
    const selectors = [
      '#storybook-root > *:not(style):not(script)',
      '#root > *:not(style):not(script)',
      '[data-story-block="true"] > *:not(style):not(script)',
      '.sb-story > *:not(style):not(script)',
      '.sb-main > *:not(style):not(script)'
    ];

    for (const selector of selectors) {
      const component = await page.$(selector);
      if (component) {
        console.error(`Found component directly with selector: ${selector}`);
        return component;
      }
    }

    console.error('No component found with any selector');
    return null;
  } catch (error) {
    console.error('Error finding component element:', error);
    return null;
  }
}

/**
 * Take screenshot of only the component element
 * @param {Page} page - Playwright page object
 * @returns {Promise<Buffer|null>} - Screenshot buffer or null if failed
 */
async function screenshotComponent(page: Page): Promise<Buffer | null> {
  const component = await findComponentElement(page);

  if (!component) {
    console.error('Could not find component to screenshot');
    return null;
  }

  try {
    // Take screenshot of just the component element
    return await component.screenshot({
      type: 'png',
      omitBackground: false
    });
  } catch (error) {
    console.error('Error taking component screenshot:', error);
    return null;
  }
}

/**
 * Capture a screenshot of a Storybook component
 *
 * This function navigates to a specific component in Storybook, applies
 * the requested state (hover, focus, etc.), and captures a screenshot
 * of just the component (not the entire Storybook UI).
 *
 * @param {CaptureOptions} options - Options for capturing the screenshot
 * @returns {Promise<CaptureResult>} Result with screenshot details
 * @throws {Error} If unable to navigate to component or capture screenshot
 */
// Import the validation function at the top of the file
import { validateOutputDirectory } from './utils.js';

export async function captureComponent(options: CaptureOptions): Promise<CaptureResult> {
  const { component, variant, state, viewport, storybookUrl, outputDir: configuredOutputDir } = options;

  // Validate and prepare the output directory
  const outputDir = await validateOutputDirectory(configuredOutputDir);

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
      waitUntil: 'load'
    });

    const storybookVersion = await detectStorybookVersion(page);
    console.error(`Detected Storybook version ${storybookVersion}`);

    // Process the component ID to extract the base ID without the variant
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
    let componentUrl = `${storybookUrl}?path=/story/${encodeURIComponent(storyId)}`;
    console.error(`Navigating to: ${componentUrl}`);

    // Go to the URL and wait for navigation to complete
    const response = await page.goto(componentUrl, { timeout: 30000, waitUntil: 'load' });

    if (!response || response.status() >= 400) {
      throw new Error(`Failed to navigate to component (status: ${response?.status() || 'unknown'})`);
    }

    // Add additional delay to ensure page is fully loaded
    await page.waitForTimeout(1000);

    // Wait for iframe to load if present (especially for Storybook 7+)
    await waitForIframeLoad(page);

    // Apply component state (hover, focus, active)
    await applyComponentState(page, state);

    // Take screenshot of just the component
    const screenshot = await screenshotComponent(page);

    if (!screenshot) {
      throw new Error('Failed to capture component screenshot');
    }

    // Generate a unique filename based on component details, viewport, and timestamp
    const stateString = getStateString(state);
    const viewportString = `${viewport.width}x${viewport.height}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Sanitize storyId to avoid path traversal issues
    // Replace any forward/backslashes with underscores
    const sanitizedStoryId = storyId.replace(/[\/\\]/g, '_');

    const filename = `${sanitizedStoryId}_${stateString}_${viewportString}_${timestamp}.png`;
    const filePath = path.join(outputDir, filename);

    // Ensure the output directory exists
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${outputDir}`, error);
      // Continue anyway, as the directory might already exist
    }

    // Log the file path we're trying to write to
    console.error(`Saving screenshot to: ${filePath}`);

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