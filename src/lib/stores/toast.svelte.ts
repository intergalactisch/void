/**
 * Toast Notification Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that manages
 * toast notifications with auto-dismiss and stacking support.
 *
 * Features:
 * - Multiple toast types: success, error, info
 * - Auto-dismiss with configurable duration
 * - Stack up to 5 toasts
 * - Progress tracking for time remaining
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

/** Toast notification types */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

/** Individual toast notification */
export interface Toast {
  /** Unique identifier */
  id: string;
  /** Type determines styling and icon */
  type: ToastType;
  /** Message to display */
  message: string;
  /** Duration in ms before auto-dismiss (0 = no auto-dismiss) */
  duration: number;
  /** Timestamp when toast was created */
  createdAt: number;
  /**
   * Optional click handler. When set, the toast is rendered as a button
   * (cursor:pointer, hover state) and `onClick()` runs when clicked,
   * after which the toast is dismissed.
   */
  onClick?: () => void;
}

/** Options for creating a toast */
export interface ToastOptions {
  /** Duration in ms (default: 3000) */
  duration?: number;
  /** Click handler — see `Toast.onClick`. */
  onClick?: () => void;
}

/** Default duration for auto-dismiss */
const DEFAULT_DURATION = 3000;

/** Maximum number of toasts to display */
const MAX_TOASTS = 5;

/**
 * Toast Store class with reactive state using Svelte 5 runes.
 *
 * Provides methods to show and dismiss toast notifications.
 */
class ToastStore {
  /** Active toast notifications */
  toasts = $state<Toast[]>([]);

  /** Map of timeout IDs for auto-dismiss */
  #timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** Counter for generating unique IDs */
  #counter = 0;

  /**
   * Generate a unique toast ID.
   */
  #generateId(): string {
    return `toast-${Date.now()}-${this.#counter++}`;
  }

  /**
   * Add a toast notification.
   *
   * @param type - Toast type (success, error, info)
   * @param message - Message to display
   * @param options - Optional configuration
   * @returns The toast ID
   */
  #add(type: ToastType, message: string, options: ToastOptions = {}): string {
    const id = this.#generateId();
    const duration = options.duration ?? DEFAULT_DURATION;

    const toast: Toast = {
      id,
      type,
      message,
      duration,
      createdAt: Date.now(),
      ...(options.onClick ? { onClick: options.onClick } : {}),
    };

    // Add to the beginning of the array (newest first)
    this.toasts = [toast, ...this.toasts].slice(0, MAX_TOASTS);

    // Set up auto-dismiss if duration > 0
    if (duration > 0) {
      const timeout = setTimeout(() => {
        this.remove(id);
      }, duration);
      this.#timeouts.set(id, timeout);
    }

    return id;
  }

  /**
   * Show a success toast.
   *
   * @param message - Success message
   * @param options - Optional configuration
   * @returns The toast ID
   */
  success(message: string, options?: ToastOptions): string {
    return this.#add('success', message, options);
  }

  /**
   * Show an error toast.
   *
   * @param message - Error message
   * @param options - Optional configuration
   * @returns The toast ID
   */
  error(message: string, options?: ToastOptions): string {
    return this.#add('error', message, options);
  }

  /**
   * Show an info toast.
   *
   * @param message - Info message
   * @param options - Optional configuration
   * @returns The toast ID
   */
  info(message: string, options?: ToastOptions): string {
    return this.#add('info', message, options);
  }

  /**
   * Show a warning toast.
   *
   * @param message - Warning message
   * @param options - Optional configuration
   * @returns The toast ID
   */
  warning(message: string, options?: ToastOptions): string {
    return this.#add('warning', message, options);
  }

  /**
   * Remove a toast by ID.
   *
   * @param id - Toast ID to remove
   */
  remove(id: string): void {
    // Clear the timeout if it exists
    const timeout = this.#timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.#timeouts.delete(id);
    }

    // Remove from the array
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /**
   * Remove all toasts.
   */
  clear(): void {
    // Clear all timeouts
    for (const timeout of this.#timeouts.values()) {
      clearTimeout(timeout);
    }
    this.#timeouts.clear();

    // Clear the array
    this.toasts = [];
  }

  /**
   * Get the number of active toasts.
   */
  get count(): number {
    return this.toasts.length;
  }

  /**
   * Check if there are any active toasts.
   */
  get hasToasts(): boolean {
    return this.toasts.length > 0;
  }
}

export const toastStore = new ToastStore();
