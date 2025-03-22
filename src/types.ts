/**
 * Type definitions for the Storybook MCP Server
 *
 * This file contains TypeScript interfaces and types used throughout
 * the application to ensure type safety and improve documentation.
 */

/**
 * Server configuration options
 */
export interface ServerConfig {
  /** URL of the Storybook instance */
  storybookUrl: string;
  /** Directory to store screenshots */
  outputDir: string;
  /** Debug mode for additional logging */
  debug?: boolean;
  /** Maximum number of connection retries */
  connectionRetries?: number;
  /** Delay between connection retries in milliseconds */
  retryDelay?: number;
  /** Whether to fail startup if Storybook can't be reached */
  failOnNoStorybook?: boolean;
}

/**
 * Represents a variant of a Storybook component
 */
export interface ComponentVariant {
  /** Unique identifier for the variant */
  id: string;
  /** Display name of the variant */
  name: string;
  /** Arguments object passed to the component for this variant */
  args: Record<string, any>;
}

/**
 * Represents a Storybook component with its metadata and variants
 */
export interface Component {
  /** Unique identifier for the component */
  id: string;
  /** Display name of the component */
  name: string;
  /** Component path in the Storybook hierarchy */
  path: string;
  /** List of variants available for this component */
  variants: ComponentVariant[];
}

/**
 * Response from the components tool
 */
export interface ComponentsResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Number of components found */
  count: number;
  /** List of components */
  components: Component[];
}

/**
 * Error response format
 */
export interface ErrorResponse {
  /** Always false for error responses */
  success: false;
  /** Brief error message */
  error: string;
  /** Detailed error information */
  details: string;
}

/**
 * Viewport dimensions
 */
export interface Viewport {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Component state options
 */
export interface ComponentState {
  /** Whether to hover over the component */
  hover?: boolean;
  /** Whether to focus the component */
  focus?: boolean;
  /** Whether to set the component to active state */
  active?: boolean;
}

/**
 * Options for capturing a component screenshot
 */
export interface CaptureOptions {
  /** Component ID to capture */
  component: string;
  /** Variant name of the component */
  variant: string;
  /** State to capture */
  state: ComponentState;
  /** Viewport dimensions for the screenshot */
  viewport: Viewport;
  /** URL of the Storybook instance */
  storybookUrl: string;
  /** Directory to store screenshots */
  outputDir: string;
}

/**
 * Result of a component capture operation
 */
export interface CaptureResult {
  /** Component ID that was captured */
  component: string;
  /** Variant name that was captured */
  variant: string;
  /** State that was captured */
  state: ComponentState;
  /** Viewport dimensions used for the screenshot */
  viewport: Viewport;
  /** File URL to access the screenshot */
  screenshotUrl: string;
  /** File path where the screenshot is stored */
  screenshotPath: string;
}

/**
 * Response from the capture tool
 */
export interface CaptureResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Result of the capture operation */
  result?: CaptureResult;
  /** Error information if operation failed */
  error?: string;
  /** Detailed error information */
  details?: string;
}

/**
 * Parameters for the capture tool
 */
export interface CaptureParams {
  /** Component ID to capture */
  component: string;
  /** Variant name (default: 'Default') */
  variant?: string;
  /** Component state */
  state?: ComponentState;
  /** Viewport dimensions */
  viewport?: Viewport;
}

/**
 * Server runtime state
 */
export interface ServerState {
  /** Whether the server is currently running */
  isRunning: boolean;
  /** Whether the server is in the process of shutting down */
  isShuttingDown: boolean;
  /** Number of active requests being processed */
  activeRequests: number;
  /** Whether the server has a valid connection to Storybook */
  storybookConnected: boolean;
}