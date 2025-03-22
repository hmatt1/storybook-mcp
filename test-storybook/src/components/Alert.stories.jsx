import React from 'react';
import Alert from './Alert';

export default {
  title: 'Components/Alert',
  component: Alert,
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['info', 'success', 'warning', 'error'],
      description: 'The visual style of the alert'
    },
    title: {
      control: 'text',
      description: 'Optional title text for the alert'
    },
    children: {
      control: 'text',
      description: 'The main content of the alert'
    },
    dismissible: {
      control: 'boolean',
      description: 'Whether to show a dismiss button'
    },
    onDismiss: {
      action: 'dismissed',
      description: 'Callback when the dismiss button is clicked'
    }
  },
  parameters: {
    layout: 'centered',
    componentSubtitle: 'Display important messages to users',
    docs: {
      description: {
        component: 'Alerts are used to communicate status, provide feedback, or give information to users in a highlighted way.'
      }
    }
  }
};

// Template for creating stories
const Template = (args) => <Alert {...args} />;

// Basic variants
export const Info = Template.bind({});
Info.args = {
  variant: 'info',
  children: 'This is an informational alert.'
};

export const Success = Template.bind({});
Success.args = {
  variant: 'success',
  children: 'Operation completed successfully!'
};

export const Warning = Template.bind({});
Warning.args = {
  variant: 'warning',
  children: 'Warning: This action cannot be undone.'
};

export const Error = Template.bind({});
Error.args = {
  variant: 'error',
  children: 'An error occurred while processing your request.'
};

// With title
export const WithTitle = Template.bind({});
WithTitle.args = {
  variant: 'info',
  title: 'Information',
  children: 'This alert has a title and content for more complex messages.'
};

// Dismissible
export const Dismissible = Template.bind({});
Dismissible.args = {
  variant: 'success',
  title: 'Success',
  children: 'You can dismiss this alert by clicking the × button.',
  dismissible: true
};

// Long content
export const LongContent = Template.bind({});
LongContent.args = {
  variant: 'info',
  title: 'Important Information',
  children: `This alert contains a longer message that spans multiple lines.
    This allows us to see how the component handles longer blocks of text.
    The content should be readable and properly formatted within the alert container.
    This helps ensure our UI remains responsive and accessible.`
};
