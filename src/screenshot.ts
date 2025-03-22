import { CaptureOptions, CaptureResult } from './storybook/types.js';
import { captureComponent as capture, closeBrowser } from './storybook/index.js';

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
  return capture(options);
}

// Export closeBrowser for resource cleanup
export { closeBrowser };
