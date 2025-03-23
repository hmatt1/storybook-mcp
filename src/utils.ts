// file: src/utils.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { chromium } from 'playwright';

/**
 * Ensure the output directory exists
 *
 * This function creates the specified directory if it doesn't exist.
 * It uses the recursive option to create parent directories as needed.
 *
 * @param {string} outputDir - Path to the directory to create
 * @returns {Promise<void>}
 * @throws {Error} If directory creation fails
 */
export async function ensureOutputDir(outputDir: string): Promise<void> {
  try {
    await fs.mkdir(outputDir, { recursive: true });
    console.error(`Output directory ready: ${outputDir}`);
  } catch (error) {
    console.error('Failed to create output directory:', error);
    throw new Error(`Failed to create output directory: ${formatErrorDetails(error)}`);
  }
}

/**
 * Validates and prepares the output directory for screenshots
 *
 * This function ensures the directory exists and resolves Docker volume mounting issues
 *
 * @param {string} outputDir - The configured output directory
 * @returns {Promise<string>} - The validated output directory path
 */
export async function validateOutputDirectory(outputDir: string): Promise<string> {
  // Check if running in Docker
  const isDocker = await fs.access('/.dockerenv').then(() => true).catch(() => false);

  console.error(`Running in Docker: ${isDocker}`);
  console.error(`Original output directory: ${outputDir}`);

  // Normalize the path - this handles different path formats
  let normalizedPath = path.normalize(outputDir);

  // In Docker, ensure paths are absolute
  if (isDocker) {
    // If path doesn't start with /, make it absolute
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = path.join(process.cwd(), normalizedPath);
      console.error(`Converted to absolute path: ${normalizedPath}`);
    }
  }

  // Attempt to create the directory, with recursive option to create parent dirs
  try {
    await fs.mkdir(normalizedPath, { recursive: true });
    console.error(`Created directory: ${normalizedPath}`);

    // Test write access by creating and removing a test file
    const testFile = path.join(normalizedPath, '.test-write-access');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    console.error(`Directory is writable: ${normalizedPath}`);
  } catch (error) {
    console.error(`Error preparing directory ${normalizedPath}:`, error);

    // Try alternative paths if we encounter permission issues
    if ((error as any).code === 'EACCES' || (error as any).code === 'EPERM') {
      const fallbackPaths = [
        '/tmp/screenshots',
        './tmp-screenshots',
        path.join(process.cwd(), 'screenshots')
      ];

      for (const fallbackPath of fallbackPaths) {
        try {
          await fs.mkdir(fallbackPath, { recursive: true });
          console.error(`Using fallback directory: ${fallbackPath}`);
          normalizedPath = fallbackPath;
          break;
        } catch (fallbackError) {
          console.error(`Fallback path failed: ${fallbackPath}`, fallbackError);
        }
      }
    }
  }

  return normalizedPath;
}

/**
 * Try multiple approaches to detect Storybook API based on version
 * Storybook has different global API objects in different versions
 *
 * @param {Page} page - Playwright page to evaluate
 * @returns {Promise<{detected: boolean, apis: string, hasIframe: boolean, hasAnyIframe: boolean}>}
 */
async function detectStorybookAPIs(page: any) {
  return page.evaluate(() => {
    const win = window as any;
    const apis = [];

    // Check for different Storybook API versions
    if (win.__STORYBOOK_CLIENT_API__) apis.push('__STORYBOOK_CLIENT_API__');
    if (win.__STORYBOOK_STORY_STORE__) apis.push('__STORYBOOK_STORY_STORE__');
    if (win.STORYBOOK_STORY_STORE) apis.push('STORYBOOK_STORY_STORE');
    if (win.__STORYBOOK_PREVIEW__) apis.push('__STORYBOOK_PREVIEW__');
    if (win.STORYBOOK_HOOKS) apis.push('STORYBOOK_HOOKS');
    if (win.__STORYBOOK_ADDONS) apis.push('__STORYBOOK_ADDONS');

    // Check for DOM evidence of Storybook
    const hasStorybookPreviewIframe = !!document.querySelector('iframe#storybook-preview-iframe');
    const hasCanvasIframe = !!document.querySelector('iframe#canvas');
    const hasAnyIframe = document.querySelectorAll('iframe').length > 0;

    return {
      detected: apis.length > 0,
      apis: apis.join(', '),
      hasStorybookPreviewIframe,
      hasCanvasIframe,
      hasAnyIframe
    };
  }).catch(error => {
    console.error('Error evaluating page:', error);
    return {
      detected: false,
      error: String(error),
      hasStorybookPreviewIframe: false,
      hasCanvasIframe: false,
      hasAnyIframe: false,
      apis: ''
    };
  });
}

/**
 * Try multiple approaches to detect Storybook through iframe content
 *
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} True if Storybook is detected in iframe
 */
async function checkStorybookIframes(page: any): Promise<boolean> {
  // Get all iframes in the page
  const frameHandles = await page.$$('iframe');
  if (frameHandles.length === 0) {
    return false;
  }

  for (const frameHandle of frameHandles) {
    try {
      // Get frame from handle
      const frameElement = await frameHandle.contentFrame();
      if (!frameElement) continue;

      // Check for Storybook evidence in the frame
      const hasStorybook = await frameElement.evaluate(() => {
        const win = window as any;
        return !!(win.__STORYBOOK_CLIENT_API__ ||
            win.__STORYBOOK_STORY_STORE__ ||
            win.STORYBOOK_STORY_STORE ||
            win.__STORYBOOK_PREVIEW__ ||
            document.querySelector('[class*="storybook"]') ||
            document.querySelector('[data-*="storybook"]'));
      }).catch(() => false);

      if (hasStorybook) {
        console.error('Detected Storybook in iframe content');
        return true;
      }
    } catch (error) {
      console.error('Error checking iframe:', error);
      // Continue to next iframe
    }
  }

  return false;
}

/**
 * Check if the Storybook URL is accessible
 *
 * This function validates that the provided URL points to a valid Storybook
 * instance by trying multiple detection methods in a fallback sequence.
 *
 * @param {string} storybookUrl - URL of the Storybook instance to check
 * @returns {Promise<void>}
 * @throws {Error} If connection fails or the URL doesn't point to a valid Storybook
 */
export async function checkStorybookConnection(storybookUrl: string): Promise<void> {
  let browser = null;

  try {
    console.error(`Checking connection to Storybook at ${storybookUrl}`);

    // Launch browser with appropriate options
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Try to navigate to the Storybook URL with a reasonable timeout
    const response = await page.goto(storybookUrl, {
      timeout: 500,
      waitUntil: 'domcontentloaded'
    });

    if (!response) {
      throw new Error(`Failed to get response from ${storybookUrl}`);
    }

    if (response.status() >= 400) {
      throw new Error(`Got HTTP error status ${response.status()} from ${storybookUrl}`);
    }

    // Capture content length for debugging
    const content = await page.content();
    console.error(`Page content length: ${content.length} characters`);

    // Detection method 1: Try to access Storybook API endpoints
    const apiEndpoints = [
      '/stories.json',              // Storybook 6+
      '/index.json',                // Some Storybook versions
      '/iframe.html?id=example',    // Common Storybook path
      '/?path=/story/example'       // Storybook URL format
    ];

    for (const endpoint of apiEndpoints) {
      try {
        console.error(`Checking endpoint: ${endpoint}`);
        const apiPage = await context.newPage();
        const apiResponse = await apiPage.goto(`${storybookUrl}${endpoint}`, {
          timeout: 10000,
          waitUntil: 'domcontentloaded'
        });

        if (apiResponse && apiResponse.status() === 200) {
          console.error(`Successfully accessed ${endpoint}`);
          await apiPage.close();
          return; // Successfully confirmed Storybook is running
        }

        console.error(`Endpoint ${endpoint} returned status: ${apiResponse?.status() || 'unknown'}`);
        await apiPage.close();
      } catch (error) {
        console.error(`Error accessing ${endpoint}: ${formatErrorDetails(error)}`);
        // Continue to next endpoint
      }
    }

    // Detection method 2: Check for Storybook API objects
    const storybookInfo = await detectStorybookAPIs(page);
    console.error('Storybook detection results:', storybookInfo);

    if (storybookInfo.detected) {
      console.error(`Successfully detected Storybook APIs: ${storybookInfo.apis}`);
      return; // API detection succeeded
    }

    // Detection method 3: Look for UI evidence
    const title = await page.title();
    const hasStorybookInTitle = title.toLowerCase().includes('storybook');
    const hasStorybookInBody = await page.content().then(content =>
        content.toLowerCase().includes('storybook')
    );

    // Additional DOM checks
    const hasStorybookClasses = await page.evaluate(() => {
      return document.querySelectorAll('[class*="storybook"]').length > 0 ||
          document.querySelectorAll('[data-*="storybook"]').length > 0;
    });

    console.error('Additional checks:', {
      title,
      hasStorybookInTitle,
      hasStorybookInBody,
      hasStorybookClasses,
      hasIframes: storybookInfo.hasAnyIframe
    });

    // Make a decision based on all evidence
    if (hasStorybookInTitle || hasStorybookInBody || hasStorybookClasses ||
        storybookInfo.hasStorybookPreviewIframe || storybookInfo.hasCanvasIframe) {
      console.error('Page appears to be Storybook based on UI evidence');
      return; // Found enough evidence
    }

    // If we got here, we couldn't confidently detect Storybook
    throw new Error(`URL ${storybookUrl} doesn't appear to be a valid Storybook instance. No Storybook APIs or UI elements detected.`);

  } catch (error) {
    console.error(`Failed to connect to Storybook at ${storybookUrl}:`, error);
    throw new Error(`Failed to connect to Storybook at ${storybookUrl}: ${formatErrorDetails(error)}`);
  } finally {
    // Ensure browser is closed to prevent resource leaks
    if (browser) {
      await browser.close().catch(console.error);
    }
  }
}

/**
 * Format error details for consistent error responses
 *
 * This function formats error objects into a consistent string format
 * for error reporting.
 *
 * @param {unknown} error - The error object to format
 * @returns {string} Formatted error message
 */
export function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    // Include stack trace for better debugging
    return `${error.message}\n${error.stack || ''}`;
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  return String(error);
}