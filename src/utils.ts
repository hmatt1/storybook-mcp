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
    console.log(`Output directory ready: ${outputDir}`);
  } catch (error) {
    console.error('Failed to create output directory:', error);
    throw new Error(`Failed to create output directory: ${formatErrorDetails(error)}`);
  }
}

/**
 * Check if the Storybook URL is accessible
 * 
 * This function validates that the provided URL points to a valid Storybook
 * instance by checking for the presence of Storybook's client API in the
 * global namespace.
 * 
 * @param {string} storybookUrl - URL of the Storybook instance to check
 * @returns {Promise<void>}
 * @throws {Error} If connection fails or the URL doesn't point to a valid Storybook
 */
export async function checkStorybookConnection(storybookUrl: string): Promise<void> {
  let browser = null;
  
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Try to navigate to the Storybook URL with a reasonable timeout
    console.log(`Checking connection to Storybook at ${storybookUrl}`);
    
    const response = await page.goto(storybookUrl, { 
      timeout: 30000,
      waitUntil: 'networkidle'
    });
    
    if (!response) {
      throw new Error(`Failed to get response from ${storybookUrl}`);
    }
    
    if (response.status() >= 400) {
      throw new Error(`Got HTTP error status ${response.status()} from ${storybookUrl}`);
    }
    
    // Check if Storybook is properly loaded by looking for its client API
    // We support different Storybook versions
    const isStorybook = await page.evaluate(() => {
      const win = window as any;
      return !!(
        win.__STORYBOOK_CLIENT_API__ || 
        win.__STORYBOOK_STORY_STORE__ || 
        win.STORYBOOK_STORY_STORE || 
        win.__STORYBOOK_PREVIEW__
      );
    }).catch(() => false);
    
    if (!isStorybook) {
      throw new Error(`URL ${storybookUrl} doesn't appear to be a valid Storybook instance`);
    }
    
    console.log(`Successfully connected to Storybook at ${storybookUrl}`);
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
    // Include stack trace in development, but could be omitted in production
    return error.message;
  }
  
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  
  return String(error);
}
