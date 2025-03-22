import React from 'react';
import { withActions } from '@storybook/addon-actions/decorator';

export const parameters = {
  actions: { 
    // argTypesRegex: '^on[A-Z].*', // Automatically create actions for args matching this regex
    handles: ['mouseover', 'click'], // Detect common HTML events
  },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
    expanded: true, // Show all controls expanded by default
    sort: 'alpha', // Sort controls alphabetically
  },
  layout: 'centered', // Center components in the canvas
  backgrounds: {
    default: 'light',
    values: [
      { name: 'light', value: '#F8F8F8' },
      { name: 'dark', value: '#333333' },
    ],
  },
  viewport: {
    viewports: {
      mobile: {
        name: 'Mobile',
        styles: {
          width: '375px',
          height: '667px',
        },
      },
      tablet: {
        name: 'Tablet',
        styles: {
          width: '768px',
          height: '1024px',
        },
      },
      desktop: {
        name: 'Desktop',
        styles: {
          width: '1440px',
          height: '900px',
        },
      },
    },
  },
};

// Wrap all stories with a common decorator
export const decorators = [
  withActions, // Apply actions decorator globally
  (Story) => (
    <div style={{ margin: '1em' }}>
      <Story />
    </div>
  ),
];
