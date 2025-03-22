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
    await page.goto(storybookUrl, { 
      timeout: 30000,
      waitUntil: 'networkidle'
    });
    
    // Wait for Storybook to initialize by checking for iframe
    console.log('Waiting for Storybook iframe to load...');
    const iframePresent = await page.waitForSelector('iframe#storybook-preview-iframe, #storybook-preview iframe', { 
      timeout: 15000,
      state: 'attached'
    }).then(() => true).catch(() => false);
    
    if (!iframePresent) {
      console.log('Storybook iframe not found, checking alternative selectors...');
      
      // Try to find any iframe
      const anyIframe = await page.locator('iframe').count();
      console.log(`Found ${anyIframe} iframes on the page`);
      
      // Dump the page HTML for debugging
      const html = await page.content();
      console.log('Page HTML (first 500 chars):', html.substring(0, 500));
      
      throw new Error('Could not find Storybook iframe');
    }
    
    // First try to fetch from Storybook's API for Storybook 8.x
    console.log('Attempting to fetch stories from the Storybook API endpoints...');
    try {
      // For Storybook v8+, first try to access the stories index
      const indexResponse = await page.goto(`${storybookUrl}/index.json`, {
        timeout: 10000,
        waitUntil: 'networkidle'
      });
      
      if (indexResponse && indexResponse.status() === 200) {
        console.log('Found index.json endpoint (Storybook 8+)');
        const indexJson = await indexResponse.json();
        
        if (indexJson && (indexJson.entries || indexJson.stories)) {
          console.log('Successfully retrieved stories from index.json');
          
          // Process stories from the index.json format (Storybook 8+)
          const components: Record<string, any> = {};
          
          // In Storybook 8, stories might be under entries or directly in stories
          const entriesMap = indexJson.entries || indexJson.stories || {};
          
          Object.entries(entriesMap).forEach(([id, entry]: [string, any]) => {
            // Skip if not a story (could be a docs page)
            if (entry.type && entry.type !== 'story') return;
            
            const componentId = entry.componentId || entry.title || id.split('--')[0];
            if (!componentId) return;
            
            const componentName = (entry.title || '').split('/').pop() || 'Unknown';
            
            if (!components[componentId]) {
              components[componentId] = {
                id: componentId,
                name: componentName,
                path: entry.title || componentId,
                variants: []
              };
            }
            
            components[componentId].variants.push({
              id: id,
              name: entry.name,
              args: entry.args || {}
            });
          });
          
          return Object.values(components) as Component[];
        }
      }
      
      // Fall back to stories.json for Storybook v6-7
      console.log('Falling back to stories.json endpoint...');
      const storiesResponse = await page.goto(`${storybookUrl}/stories.json`, {
        timeout: 10000,
        waitUntil: 'networkidle'
      });
      
      if (storiesResponse && storiesResponse.status() === 200) {
        console.log('Found stories.json endpoint');
        const storiesJson = await storiesResponse.json();
        
        if (storiesJson && storiesJson.stories) {
          console.log(`Found ${Object.keys(storiesJson.stories).length} stories from stories.json`);
          
          const components: Record<string, any> = {};
          
          // Process stories from the stories.json format
          Object.entries(storiesJson.stories).forEach(([id, story]: [string, any]) => {
            const componentId = story.componentId || story.kind || story.title;
            if (!componentId) return;
            
            const componentName = (story.title || story.kind || '').split('/').pop() || 'Unknown';
            
            if (!components[componentId]) {
              components[componentId] = {
                id: componentId,
                name: componentName,
                path: story.title || story.kind || componentId,
                variants: []
              };
            }
            
            components[componentId].variants.push({
              id: id,
              name: story.name,
              args: story.parameters?.args || story.args || {}
            });
          });
          
          return Object.values(components) as Component[];
        }
      }
    } catch (error) {
      console.log('Error fetching stories from API endpoint:', error);
      // Continue to try other methods
    }
    
    // If static files failed, try to extract from the iframe
    console.log('Falling back to extracting stories from Storybook UI...');
    
    // Wait for a bit more time to ensure Storybook is fully loaded
    await page.waitForTimeout(5000);
    
    // Try to find the iframe with the Storybook content
    const frameHandle = await page.waitForSelector('iframe#storybook-preview-iframe, #storybook-preview iframe')
      .catch(() => null);
      
    if (!frameHandle) {
      throw new Error('Storybook iframe not found');
    }
    
    const frame = await frameHandle.contentFrame();
    if (!frame) {
      throw new Error('Could not access iframe content');
    }
    
    // Extract component data using page.evaluate to run code in the browser context
    const componentData = await page.evaluate(() => {
      // Access Storybook's internal API
      // Note: This is subject to change with Storybook versions
      const win = window as any;
      
      function logAvailableAPIs() {
        const apis = [];
        if (win.__STORYBOOK_CLIENT_API__) apis.push('__STORYBOOK_CLIENT_API__');
        if (win.__STORYBOOK_STORY_STORE__) apis.push('__STORYBOOK_STORY_STORE__');
        if (win.__STORYBOOK_PREVIEW__) apis.push('__STORYBOOK_PREVIEW__');
        if (win.STORYBOOK_STORY_STORE) apis.push('STORYBOOK_STORY_STORE');
        if (win.__STORYBOOK_ADDONS_CHANNEL__) apis.push('__STORYBOOK_ADDONS_CHANNEL__');
        return apis;
      }
      
      console.log('Available Storybook APIs:', logAvailableAPIs());
      
      // Support different Storybook versions
      let stories;
      try {
        // Storybook 8 often uses a different API structure
        if (win.__STORYBOOK_STORY_STORE__?.storyIndex?.entries) {
          // Storybook 8 format
          stories = Object.entries(win.__STORYBOOK_STORY_STORE__.storyIndex.entries)
            .filter(([_, entry]: [string, any]) => entry.type === 'story')
            .map(([id, entry]: [string, any]) => ({
              id,
              kind: entry.title,
              title: entry.title,
              name: entry.name,
              componentId: entry.componentId,
              args: entry.args || {}
            }));
        } else if (win.__STORYBOOK_STORY_STORE__?.getStoriesJsonData) {
          // Storybook 7 format
          stories = Object.values(win.__STORYBOOK_STORY_STORE__.getStoriesJsonData().stories);
        } else if (win.STORYBOOK_STORY_STORE?.getStoriesJsonData) {
          stories = Object.values(win.STORYBOOK_STORY_STORE.getStoriesJsonData().stories);
        } else if (win.__STORYBOOK_PREVIEW__?.storyStore?.getStoriesJsonData) {
          stories = Object.values(win.__STORYBOOK_PREVIEW__.storyStore.getStoriesJsonData().stories);
        } else if (win.__STORYBOOK_CLIENT_API__?.raw) {
          // Older Storybook versions
          stories = win.__STORYBOOK_CLIENT_API__.raw();
        } else {
          // Try to find stories in the sidebar
          const sidebarItems = document.querySelectorAll('[data-nodetype="story"], [data-item-type="story"]');
          if (sidebarItems && sidebarItems.length > 0) {
            stories = Array.from(sidebarItems).map(item => {
              const id = item.getAttribute('data-item-id') || '';
              const title = (item.getAttribute('data-parent-id') || '').split('/');
              const name = item.textContent || '';
              
              return {
                id,
                kind: title.join('/'),
                title: title.join('/'),
                name
              };
            });
          } else {
            throw new Error('Could not find Storybook stories data');
          }
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
    
    console.log(`Successfully extracted ${componentData.length} components`);
    return componentData as Component[];
  } catch (error) {
    console.error('Error retrieving components:', error);
    throw error;
  } finally {
    // Ensure browser is closed to prevent resource leaks
    await browser.close();
  }
}
