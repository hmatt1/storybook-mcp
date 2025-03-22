/**
 * Component state for screenshots
 */
export interface ComponentState {
  hover?: boolean;
  focus?: boolean;
  active?: boolean;
}

/**
 * Options for capturing a component screenshot
 */
export interface CaptureOptions {
  /** Component identifier (should match Storybook ID) */
  component: string;
  
  /** Variant name */
  variant: string;
  
  /** State to capture (hover, focus, active) */
  state: ComponentState;
  
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  
  /** Storybook URL */
  storybookUrl: string;
  
  /** Output directory for screenshots */
  outputDir: string;
  
  /** Optional args to pass to the story */
  args?: Record<string, any>;
}

/**
 * Result of capturing a component screenshot
 */
export interface CaptureResult {
  /** Component identifier */
  component: string;
  
  /** Variant name */
  variant: string;
  
  /** Component state that was captured */
  state: ComponentState;
  
  /** Viewport dimensions used */
  viewport: {
    width: number;
    height: number;
  };
  
  /** URL to the screenshot (file://) */
  screenshotUrl: string;
  
  /** Path to the screenshot on disk */
  screenshotPath: string;
  
  /** Whether the capture was successful */
  success: boolean;
}
