import { Page, ElementHandle } from 'playwright';
import { ComponentState } from './types.js';

/**
 * Apply state to a component in the page (hover, focus, active)
 * @param {Page} page - Playwright page object
 * @param {ComponentState} state - Component state to apply
 * @returns {Promise<void>}
 */
export async function applyComponentState(page: Page, state: ComponentState): Promise<void> {
  if (!state || (!state.hover && !state.focus && !state.active)) {
    return; // No state to apply
  }

  try {
    // First try to find the component in an iframe (for Storybook 7+)
    const iframe = await page.$('iframe[id="storybook-preview-iframe"]');

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
export async function findComponentElement(page: Page): Promise<ElementHandle | null> {
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

      // If we didn't find with specific selectors, try a broader approach
      const rootElement = await frame.$('#storybook-root, #root, [data-story-block="true"]');
      if (rootElement) {
        // Take the first child element if it exists
        const firstChild = await frame.evaluateHandle(root => {
          const children = root.querySelectorAll(':scope > *:not(style):not(script)');
          return children.length > 0 ? children[0] : null;
        }, rootElement);
        
        if (firstChild && !(await firstChild.evaluate(node => node === null))) {
          console.error('Found component using root element first child approach');
          return firstChild as ElementHandle;
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
export async function screenshotComponent(page: Page): Promise<Buffer | null> {
  const component = await findComponentElement(page);

  if (!component) {
    console.error('Could not find component to screenshot');
    
    // Fallback to full iframe if component not found
    const iframe = await page.$('iframe[id="storybook-preview-iframe"]');
    if (iframe) {
      console.error('Falling back to full iframe screenshot');
      const frame = await iframe.contentFrame();
      if (frame) {
        // Try to screenshot the root element
        const root = await frame.$('#storybook-root, #root, [data-story-block="true"]');
        if (root) {
          console.error('Taking screenshot of root element');
          return await root.screenshot({
            type: 'png',
            omitBackground: false
          });
        }
      }
      
      // If we can't find the root, screenshot the whole iframe
      console.error('Taking screenshot of entire iframe');
      return await iframe.screenshot({
        type: 'png',
        omitBackground: false
      });
    }
    
    // Last resort - full page screenshot
    console.error('No component or iframe found, taking full page screenshot');
    return await page.screenshot({
      type: 'png',
      fullPage: false
    });
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
