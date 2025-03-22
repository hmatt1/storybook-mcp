import { chromium, Browser } from 'playwright';
import { Component, ComponentVariant } from './types.js';

/**
 * Retrieves all components and their variants from a Storybook instance
 * 
 * This function connects to a running Storybook instance and extracts
 * component metadata using Storybook's internal API. It creates a structured
 * representation of all components and their variants.
 * 
 * @param {string} storybookUrl - The URL of the running Storybook instance
 * @returns {Promise<Component[]>} List of components with their variants
 * @throws {Error} If unable to connect to Storybook or extract component data
 * 
 * @example
 * ```ts
 * const components = await getComponents('http://localhost:6006');
 * console.log(`Found ${components.length} components`);
 * ```
 */
export async function getComponents(storybookUrl: string): Promise<Component[]> {
  // Launch a new browser instance for this operation
  // We don't reuse the global instance to avoid potential race conditions
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Go to Storybook URL and wait for network to idle
    console.log(`Navigating to Storybook at ${storybookUrl}`);
    const response = await page.goto(storybookUrl, { 
      timeout: 30000,
      waitUntil: 'networkidle'
    });
    
    if (!response || response.status() >= 400) {
      throw new Error(`Failed to load Storybook (status: ${response?.status() || 'unknown'})`);
    }
    
    // Wait for Storybook to initialize by checking for the presence of
    // its internal API objects in the global namespace
    await page.waitForFunction(() => {
      const win = window as any;
      return (
        // Support for different Storybook versions/configurations
        (win.__STORYBOOK_CLIENT_API__ && win.__STORYBOOK_STORY_STORE__) || 
        (win.STORYBOOK_STORY_STORE && win.STORYBOOK_STORY_STORE.getStoriesJsonData) ||
        (win.__STORYBOOK_PREVIEW__ && win.__STORYBOOK_PREVIEW__.storyStore?.getStoriesJsonData)
      );
    }, { timeout: 15000 });
    
    // Extract component data using page.evaluate to run code in the browser context
    const componentData = await page.evaluate(() => {
      // Access Storybook's internal API
      // Note: This is subject to change with Storybook versions
      const win = window as any;
      
      // Support different Storybook versions
      let stories;
      try {
        if (win.__STORYBOOK_STORY_STORE__?.getStoriesJsonData) {
          stories = Object.values(win.__STORYBOOK_STORY_STORE__.getStoriesJsonData().stories);
        } else if (win.STORYBOOK_STORY_STORE?.getStoriesJsonData) {
          stories = Object.values(win.STORYBOOK_STORY_STORE.getStoriesJsonData().stories);
        } else if (win.__STORYBOOK_PREVIEW__?.storyStore?.getStoriesJsonData) {
          stories = Object.values(win.__STORYBOOK_PREVIEW__.storyStore.getStoriesJsonData().stories);
        } else if (win.__STORYBOOK_CLIENT_API__?.raw) {
          // Older Storybook versions
          stories = win.__STORYBOOK_CLIENT_API__.raw();
        } else {
          throw new Error('Could not find Storybook stories data');
        }
      } catch (e: any) {
        console.error('Error accessing Storybook API:', e);
        return { error: e.message || 'Unknown error accessing Storybook API' };
      }
      
      // Validate that we got stories data
      if (!stories || !Array.isArray(stories)) {
        return { error: 'Invalid stories data: ' + (typeof stories) };
      }
      
      const components: Record<string, any> = {};
      
      // Group stories by component
      stories.forEach((story: any) => {
        // Skip if invalid story data
        if (!story || typeof story !== 'object') return;
        
        // Get component ID - fallback handling for different Storybook versions
        const componentId = story.componentId || story.kind || story.title;
        if (!componentId) return;
        
        // Get component name (last part of the path)
        const componentName = (story.title || story.kind || '').split('/').pop() || 'Unknown';
        
        // Create component entry if it doesn't exist yet
        if (!components[componentId]) {
          components[componentId] = {
            id: componentId,
            name: componentName,
            path: story.title || story.kind || componentId,
            variants: []
          };
        }
        
        // Add this story as a variant to the component
        components[componentId].variants.push({
          id: story.id,
          name: story.name,
          args: story.parameters?.args || story.args || {}
        });
      });
      
      return Object.values(components);
    });
    
    // Check for errors in component extraction
    if ('error' in componentData) {
      throw new Error(`Failed to extract components: ${componentData.error}`);
    }
    
    return componentData as Component[];
  } catch (error) {
    console.error('Error retrieving components:', error);
    throw error;
  } finally {
    // Ensure browser is closed to prevent resource leaks
    await browser.close();
  }
}
