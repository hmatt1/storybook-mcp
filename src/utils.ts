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
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Try to navigate to the Storybook URL with a reasonable timeout
    console.error(`Checking connection to Storybook at ${storybookUrl}`);
    
    const response = await page.goto(storybookUrl, { 
      timeout: 30000,
      waitUntil: 'domcontentloaded'  // Changed from 'networkidle' to 'domcontentloaded'
    });
    
    if (!response) {
      console.error(`No response received from ${storybookUrl}`);
      throw new Error(`Failed to get response from ${storybookUrl}`);
    }
    
    if (response.status() >= 400) {
      console.error(`HTTP error ${response.status()} when accessing ${storybookUrl}`);
      throw new Error(`Got HTTP error status ${response.status()} from ${storybookUrl}`);
    }
    
    // Capture the page content for debugging
    const content = await page.content();
    console.error(`Page content length: ${content.length} characters`);
    
    // Try to access stories.json directly as a more reliable check
    console.error('Checking if stories.json endpoint is available...');
    try {
      const storiesResponse = await context.newPage().then(p => 
        p.goto(`${storybookUrl}/stories.json`, { timeout: 10000 })
      );
      
      if (storiesResponse && storiesResponse.status() === 200) {
        console.error('stories.json endpoint is available');
        return; // Successfully confirmed Storybook is running
      } else {
        console.error(`stories.json endpoint returned status: ${storiesResponse?.status() || 'unknown'}`);
      }
    } catch (error) {
      console.error(`Could not access stories.json: ${formatErrorDetails(error)}`);
      // Continue with alternative checks
    }
    
    // Check if Storybook is properly loaded by looking for its client API
    // We support different Storybook versions
    const storybookInfo = await page.evaluate(() => {
      const win = window as any;
      const apis = [];
      
      if (win.__STORYBOOK_CLIENT_API__) apis.push('__STORYBOOK_CLIENT_API__');
      if (win.__STORYBOOK_STORY_STORE__) apis.push('__STORYBOOK_STORY_STORE__');
      if (win.STORYBOOK_STORY_STORE) apis.push('STORYBOOK_STORY_STORE');
      if (win.__STORYBOOK_PREVIEW__) apis.push('__STORYBOOK_PREVIEW__');
      
      return {
        detected: apis.length > 0,
        apis: apis.join(', '),
        hasIframe: !!document.querySelector('iframe#storybook-preview-iframe'),
        hasAnyIframe: document.querySelectorAll('iframe').length > 0
      };
    }).catch(error => {
      console.error('Error evaluating page:', error);
      return { 
        detected: false, 
        error: String(error),
        hasIframe: false,
        hasAnyIframe: false,
        apis: ''
      };
    });
    
    console.error('Storybook detection results:', storybookInfo);
    
    if (!storybookInfo.detected) {
      // Look for any evidence this is Storybook
      const title = await page.title();
      const hasStorybookInTitle = title.toLowerCase().includes('storybook');
      const hasStorybookInBody = await page.content().then(content => 
        content.toLowerCase().includes('storybook')
      );
      
      console.error('Additional checks:', {
        title,
        hasStorybookInTitle,
        hasStorybookInBody
      });
      
      if (!hasStorybookInTitle && !hasStorybookInBody && !storybookInfo.hasAnyIframe) {
        throw new Error(`URL ${storybookUrl} doesn't appear to be a valid Storybook instance`);
      } else {
        console.error('Page appears to be Storybook despite missing API detection');
      }
    }
    
    console.error(`Successfully connected to Storybook at ${storybookUrl}`);
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
