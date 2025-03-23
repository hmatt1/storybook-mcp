import * as path from 'path';
import * as fs from 'fs/promises';
import * as url from 'url';
import { CaptureOptions, CaptureResult } from './types.js';
import { getBrowser } from './browser.js';
import { 
  validateOutputDirectory, 
  getStateString, 
  prepareForStorybookUrl, 
  formatArgsForUrl
} from './utils.js';
import { detectStorybookVersion } from './storybook-version.js';
import { 
  selectVariantInStorybook,
  verifyVariantLoaded,
  waitForIframeLoad
} from './variant-selection.js';
import { 
  applyComponentState,
  screenshotComponent
} from './component-state.js';

function getComponentUrl(component: string, variant: string, storybookUrl: string) {
  // Input validation
  if (!component) {
    console.error('Component parameter is required');
    return { storyId: '', componentUrl: storybookUrl };
  }

  // Normalize the component string
  const normalizedComponent = component.trim();

  // Process the component ID to extract the base ID without the variant
  let storyId;
  let urlPath;

  // If component already includes a variant (contains --), we need to handle it correctly
  if (normalizedComponent.includes('--')) {
    // Use the component ID as is for the storyId, but ensure proper formatting
    storyId = normalizedComponent.toLowerCase().replace(/\//g, '-');
    urlPath = 'story';
  } else {
    // Convert potential path structure (with slashes) to the format Storybook expects
    const formattedComponent = normalizedComponent.toLowerCase().replace(/\//g, '-');

    if (variant && variant.trim()) {
      // If we have a non-empty variant, use the story path
      const formattedVariant = prepareForStorybookUrl(variant);
      storyId = `${formattedComponent}--${formattedVariant}`;
      urlPath = 'story';
    } else {
      // For components without variants, use the docs path
      storyId = `${formattedComponent}--docs`;
      urlPath = 'docs';
    }
  }

  console.log(`Component: ${component}, Variant: ${variant}, StoryId: ${storyId}, Path: ${urlPath}`);

  // Ensure the storybookUrl is valid
  if (!storybookUrl) {
    console.error('Storybook URL is required');
    return { storyId, componentUrl: '' };
  }

  // Ensure the storybookUrl has a trailing slash if it doesn't end with one
  const baseUrl = storybookUrl.endsWith('/') ? storybookUrl : `${storybookUrl}/`;

  // Construct the final URL
  const componentUrl = `${baseUrl}?path=/${urlPath}/${encodeURIComponent(storyId)}`;
  return { storyId, componentUrl };
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
export async function captureComponent(options: CaptureOptions): Promise<CaptureResult> {
  const { component, variant, state, viewport, storybookUrl, outputDir: configuredOutputDir, args } = options;

  console.error("Options:", options);

  // Validate and prepare the output directory
  console.error(`Original output directory: ${configuredOutputDir}`);
  const outputDir = await validateOutputDirectory(configuredOutputDir);

  try {
    // Ensure the output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    console.error(`Created directory: ${outputDir}`);

    // Test if directory is writable
    const testFile = path.join(outputDir, '.write-test');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    console.error(`Directory is writable: ${outputDir}`);
  } catch (error) {
    console.error(`Error with output directory: ${error}`);
    throw new Error(`Cannot write to output directory: ${outputDir}`);
  }

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
    let {storyId, componentUrl} = getComponentUrl(component, variant, storybookUrl);

    // Add args to URL if provided
    if (args && Object.keys(args).length > 0) {
      const argsString = formatArgsForUrl(args);
      componentUrl += argsString;
      console.error(`Added args to URL: ${argsString}`);
    }

    // Log for debugging
    console.error(`Navigating to component URL: ${componentUrl}`);
    console.error(`Component ID: ${component}, Variant: ${variant}, StoryID: ${storyId}`);

    // Go to the URL and wait for navigation to complete
    const response = await page.goto(componentUrl, { timeout: 30000, waitUntil: 'load' });

    if (!response || response.status() >= 400) {
      throw new Error(`Failed to navigate to component (status: ${response?.status() || 'unknown'})`);
    }

    // Add additional delay to ensure page is fully loaded
    await page.waitForTimeout(1000);

    // Wait for iframe to load if present
    const iframeLoaded = await waitForIframeLoad(page);
    
    if (!iframeLoaded) {
      console.error('Iframe did not load properly, checking page content');
      // Check if there's any content on the page that looks like a component
      const hasComponent = await page.evaluate(() => {
        const root = document.querySelector('#storybook-root, #root, [data-story-block="true"]');
        return root && (root.children.length > 0);
      });
      
      if (!hasComponent) {
        console.error('No component found in page, trying to reload');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        
        // Try to wait for iframe again
        await waitForIframeLoad(page);
      }
    }

    // Try to explicitly select the variant if it's not already selected
    const variantSelected = await selectVariantInStorybook(page, variant);
    console.error(`Variant selection result: ${variantSelected ? 'Success' : 'Not found/already selected'}`);

    // Verify that the correct variant is loaded
    const variantVerified = await verifyVariantLoaded(page, variant);
    console.error(`Variant verification result: ${variantVerified ? 'Verified' : 'Could not verify'}`);

    if (!variantVerified) {
      console.error('Could not verify variant was loaded, attempting to continue anyway');
    }

    // Additional wait after variant selection to ensure component is properly rendered
    await page.waitForTimeout(1000);

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

    // Add args hash to filename if args were provided
    let argsHash = '';
    if (args && Object.keys(args).length > 0) {
      // Create a simple hash of the args to include in the filename
      argsHash = `-args_${Object.entries(args)
        .map(([key, value]) => `${key}_${value}`)
        .join('_')
        .replace(/[^a-zA-Z0-9_-]/g, '')}`;
      
      // Limit the length to avoid too long filenames
      if (argsHash.length > 50) {
        argsHash = argsHash.substring(0, 50);
      }
    }

    const filename = `${sanitizedStoryId}${argsHash}_${stateString}_${viewportString}_${timestamp}.png`;
    const filePath = path.join(outputDir, filename);

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
      screenshotPath: filePath,
      success: true
    };
  } catch (error) {
    console.error('Error capturing component:', error);
    throw error;
  } finally {
    // Release page resources
    await page.close();
  }
}