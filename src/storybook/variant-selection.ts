import { Page } from 'playwright';

/**
 * Select a specific variant in the Storybook UI
 * @param {Page} page - Playwright page object
 * @param {string} variantName - Name of the variant to select
 * @returns {Promise<boolean>} - Whether the variant was successfully selected
 */
export async function selectVariantInStorybook(page: Page, variantName: string): Promise<boolean> {
  try {
    console.error(`Attempting to select variant: "${variantName}"`);

    // First check if we have an iframe
    const iframe = await page.$('iframe[id="storybook-preview-iframe"]');

    // If we have an iframe, we need to check the sidebar in the parent frame
    if (!iframe) {
      // Try to find the variant in the sidebar
      const variantSelectors = [
        // Storybook 6 selectors
        `.sidebar-item[data-nodeid*="${variantName.toLowerCase()}"]`,
        `.sidebar-item[data-item-id*="${variantName.toLowerCase()}"]`,
        // Storybook 7 selectors
        `[data-selected="false"]:has-text("${variantName}")`,
        `button:has-text("${variantName}")`,
        // General text match
        `text="${variantName}"`,
        // Case insensitive variant
        `[data-nodeid*="${variantName.toLowerCase()}"]`,
        `[data-item-id*="${variantName.toLowerCase()}"]`
      ];

      for (const selector of variantSelectors) {
        console.error(`Trying to select variant with selector: ${selector}`);

        // Try to find the variant
        const variantElement = await page.$(selector);
        if (variantElement) {
          console.error(`Found variant element with selector: ${selector}`);

          // Click the variant
          await variantElement.click();
          console.error(`Clicked on variant element`);

          // Wait for the component to update
          await page.waitForTimeout(500);
          return true;
        }
      }

      console.error(`Could not find variant "${variantName}" in sidebar`);
    } else {
      console.error(`Found iframe, checking for controls panel to select variant`);

      // In some Storybook versions, variants are in a controls panel
      // Try to find the controls panel and select the variant from there
      const controlsSelectors = [
        // Storybook controls panel
        `button:has-text("Controls")`,
        `[role="tab"]:has-text("Controls")`,
        `[data-nodeid="controls"]`
      ];

      for (const selector of controlsSelectors) {
        const controlsTab = await page.$(selector);
        if (controlsTab) {
          console.error(`Found controls tab, clicking it`);
          await controlsTab.click();
          await page.waitForTimeout(300);

          // Now look for variant selection dropdown or radio buttons
          const variantSelectors = [
            `select`,
            `[role="radio"]:has-text("${variantName}")`,
            `label:has-text("${variantName}")`,
            `button:has-text("${variantName}")`
          ];

          for (const varSelector of variantSelectors) {
            const variantControl = await page.$(varSelector);
            if (variantControl) {
              console.error(`Found variant control with selector: ${varSelector}`);
              await variantControl.click();
              await page.waitForTimeout(500);
              return true;
            }
          }
        }
      }
    }

    // If we couldn't select the variant by UI, we might be already on the right variant
    // or the URL might have correctly loaded it
    console.error(`Could not explicitly select variant "${variantName}" through UI, continuing anyway`);
    return false;
  } catch (error) {
    console.error(`Error selecting variant: ${error}`);
    return false;
  }
}

/**
 * Verify that the correct variant is loaded by checking the component/DOM
 * @param {Page} page - Playwright page object
 * @param {string} variantName - Name of the variant to verify
 * @returns {Promise<boolean>} - Whether the variant appears to be correctly loaded
 */
export async function verifyVariantLoaded(page: Page, variantName: string): Promise<boolean> {
  try {
    // First check if we have an iframe
    const iframe = await page.$('iframe[id="storybook-preview-iframe"]');

    if (iframe) {
      const frame = await iframe.contentFrame();
      if (!frame) {
        console.error(`Could not access iframe content frame`);
        return false;
      }

      // Try to find evidence that the correct variant is loaded
      const hasVariantClass = await frame.evaluate((variant) => {
        // Check if any element has a class or attribute related to the variant
        const root = document.querySelector('#storybook-root, #root, [data-story-block="true"]');
        if (!root) {
          console.error('Could not find root element in iframe');
          return false;
        }

        // Check for variant name in attributes
        const allElements = root.querySelectorAll('*');
        for (const el of Array.from(allElements)) {
          const attributes = Array.from(el.attributes);
          for (const attr of attributes) {
            if (attr.value.toLowerCase().includes(variant.toLowerCase())) {
              return true;
            }
          }
        }

        // Check for variant name in text content
        if (root.textContent?.toLowerCase().includes(variant.toLowerCase())) {
          return true;
        }

        return false;
      }, variantName);

      if (hasVariantClass) {
        console.error(`Found evidence that variant "${variantName}" is loaded in the iframe`);
        return true;
      }

      // If we couldn't find direct evidence, check if any component is rendered at all
      const hasComponent = await frame.evaluate(() => {
        const root = document.querySelector('#storybook-root, #root, [data-story-block="true"]');
        if (!root) return false;
        
        // Check if there are any child elements in the root
        return root.children.length > 0;
      });

      if (hasComponent) {
        console.error(`Found component in iframe but couldn't verify variant "${variantName}" specifically`);
        return true;
      } else {
        console.error(`No component found in iframe - variant "${variantName}" may not be loaded`);
        return false;
      }
    }

    // If no iframe, check the page itself
    const hasComponent = await page.evaluate(() => {
      const root = document.querySelector('#storybook-root, #root, [data-story-block="true"]');
      if (!root) return false;
      
      // Check if there are any child elements in the root
      return root.children.length > 0;
    });

    if (hasComponent) {
      console.error(`Found component in page but couldn't verify variant "${variantName}" specifically`);
      return true;
    }

    console.error(`Could not verify variant "${variantName}" is loaded`);
    return false;
  } catch (error) {
    console.error(`Error verifying variant: ${error}`);
    return false;
  }
}

/**
 * Wait for the iframe to load (Storybook 7+)
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} - Whether the iframe was found and loaded
 */
export async function waitForIframeLoad(page: Page): Promise<boolean> {
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
        try {
          await frameHandle.waitForSelector(
              '#storybook-root > *, #root > *, [data-story-block="true"] > *',
              { timeout: 10000 }
          );
          console.error('Iframe content loaded and component found');
          return true;
        } catch (error) {
          console.error('Timeout waiting for component in iframe:', error);
          // Check if there's any content in the root elements
          const hasContent = await frameHandle.evaluate(() => {
            const root = document.querySelector('#storybook-root, #root, [data-story-block="true"]');
            return root && (root.innerHTML.trim().length > 0);
          });
          
          if (hasContent) {
            console.error('Found content in iframe but not matching selectors');
            return true;
          }
          return false;
        }
      }
    } else {
      console.error('No iframe found, assuming direct rendering');
      return false;
    }
    
    return false;
  } catch (error) {
    console.error('Error waiting for iframe load:', error);
    return false;
  }
}
