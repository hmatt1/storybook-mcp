import * as fs from 'fs/promises';
import * as path from 'path';
import { ComponentState } from './types.js';

/**
 * Validates and ensures the output directory exists
 * @param {string} outputDir - The output directory path
 * @returns {Promise<string>} The validated output directory path
 */
export async function validateOutputDirectory(outputDir: string): Promise<string> {
  if (!outputDir) {
    throw new Error('Output directory is required');
  }

  // Resolve the absolute path
  const resolvedPath = path.resolve(outputDir);
  
  try {
    // Ensure the directory exists
    await fs.mkdir(resolvedPath, { recursive: true });
    
    // Test write permissions
    const testFile = path.join(resolvedPath, '.write-test');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    
    return resolvedPath;
  } catch (error) {
    console.error(`Error validating output directory: ${error}`);
    throw new Error(`Invalid output directory: ${resolvedPath} - ${error}`);
  }
}

/**
 * Prepare a string for use in a Storybook URL
 * @param {string} str - The string to prepare
 * @returns {string} - A URL-safe string for Storybook
 */
export function prepareForStorybookUrl(str: string): string {
  // Log the original string for debugging
  console.error(`Preparing string for URL: "${str}"`);

  if (!str || typeof str !== 'string') {
    console.error(`Invalid variant string: ${str}, using "default"`);
    return 'default';
  }

  // Convert to lowercase and replace spaces with dashes
  const prepared = str
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '')
      .trim();

  console.error(`Prepared string: "${prepared}"`);
  return prepared;
}

/**
 * Create a string representation of component state for use in filenames
 * @param {ComponentState} state - The component state
 * @returns {string} - String representation of the state
 */
export function getStateString(state: ComponentState): string {
  if (!state || (!state.hover && !state.focus && !state.active)) {
    return 'default';
  }

  const states = [];
  if (state.hover) states.push('hover');
  if (state.focus) states.push('focus');
  if (state.active) states.push('active');

  return states.join('-');
}

/**
 * Format story args for URL
 * @param {Record<string, any>} args - The args object
 * @returns {string} - Formatted args string for URL
 */
export function formatArgsForUrl(args?: Record<string, any>): string {
  if (!args || Object.keys(args).length === 0) {
    return '';
  }

  // Serialize each arg for the URL
  const argParts = Object.entries(args).map(([key, value]) => {
    // Handle different value types
    let serializedValue: string;
    
    if (typeof value === 'boolean') {
      serializedValue = value ? '!true' : '!false';
    } else if (typeof value === 'number') {
      serializedValue = value.toString();
    } else if (typeof value === 'string') {
      // If string contains special characters, you might need to encode it
      serializedValue = value;
    } else if (value === null) {
      serializedValue = '!null';
    } else if (Array.isArray(value)) {
      // Handle arrays - simplified version
      serializedValue = `!${JSON.stringify(value)}`;
    } else if (typeof value === 'object') {
      // Handle objects - simplified version
      serializedValue = `!${JSON.stringify(value)}`;
    } else {
      // Default fallback
      serializedValue = String(value);
    }
    
    return `${key}:${serializedValue}`;
  });
  
  return `&args=${argParts.join(';')}`;
}
