import { Page } from 'playwright';

/**
 * Detect Storybook version from the page
 * @param {Page} page - Playwright page object
 * @returns {Promise<number>} - Major version number (6, 7, or 8)
 */
export async function detectStorybookVersion(page: Page): Promise<number> {
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
