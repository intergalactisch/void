/**
 * Focus Trap Utility
 *
 * Traps keyboard focus within a container element for modal dialogs.
 * Implements WCAG 2.1 modal dialog requirements.
 */

export interface FocusTrapOptions {
  /** Element to trap focus within */
  container: HTMLElement;
  /** Element to focus initially (defaults to first focusable) */
  initialFocus?: HTMLElement | null;
  /** Element to return focus to on close (defaults to previously focused element) */
  returnFocus?: HTMLElement | null;
  /** Callback when escape is pressed */
  onEscape?: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

interface ActiveFocusTrap {
  container: HTMLElement;
  initialFocus: HTMLElement | null | undefined;
  previouslyFocused: HTMLElement | null;
  onEscape: (() => void) | undefined;
  addedContainerTabIndex: boolean;
}

const activeTraps: ActiveFocusTrap[] = [];
let documentListenersActive = false;

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null // Visible elements only
  );
}

function getTopTrap(): ActiveFocusTrap | undefined {
  return activeTraps[activeTraps.length - 1];
}

function focusInitial(trap: ActiveFocusTrap) {
  if (!document.body.contains(trap.container)) return;

  if (trap.initialFocus && document.body.contains(trap.initialFocus)) {
    trap.initialFocus.focus({ preventScroll: true });
    return;
  }

  const firstElement = getFocusableElements(trap.container)[0];
  if (firstElement) {
    firstElement.focus({ preventScroll: true });
    return;
  }

  trap.container.focus({ preventScroll: true });
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  const trap = getTopTrap();
  if (!trap) return;

  if (event.key === 'Escape' && trap.onEscape) {
    event.preventDefault();
    event.stopPropagation();
    trap.onEscape();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusables = getFocusableElements(trap.container);
  if (focusables.length === 0) {
    event.preventDefault();
    trap.container.focus({ preventScroll: true });
    return;
  }

  const firstFocusable = focusables[0];
  const lastFocusable = focusables[focusables.length - 1];
  if (!firstFocusable || !lastFocusable) return;

  const activeElement = document.activeElement;
  if (!trap.container.contains(activeElement)) {
    event.preventDefault();
    (event.shiftKey ? lastFocusable : firstFocusable).focus({ preventScroll: true });
    return;
  }

  if (event.shiftKey && activeElement === firstFocusable) {
    event.preventDefault();
    lastFocusable.focus({ preventScroll: true });
    return;
  }

  if (!event.shiftKey && activeElement === lastFocusable) {
    event.preventDefault();
    firstFocusable.focus({ preventScroll: true });
  }
}

function handleDocumentFocusIn(event: FocusEvent) {
  const trap = getTopTrap();
  if (!trap) return;

  const target = event.target as Node | null;
  if (target && !trap.container.contains(target)) {
    focusInitial(trap);
  }
}

function ensureDocumentListeners() {
  if (documentListenersActive) return;
  document.addEventListener('keydown', handleDocumentKeyDown, true);
  document.addEventListener('focusin', handleDocumentFocusIn, true);
  documentListenersActive = true;
}

function cleanupDocumentListeners() {
  if (!documentListenersActive || activeTraps.length > 0) return;
  document.removeEventListener('keydown', handleDocumentKeyDown, true);
  document.removeEventListener('focusin', handleDocumentFocusIn, true);
  documentListenersActive = false;
}

/**
 * Create a focus trap for a container element.
 * Returns a cleanup function to remove the trap.
 */
export function createFocusTrap(options: FocusTrapOptions): () => void {
  const { container, initialFocus, returnFocus, onEscape } = options;

  // Store the previously focused element to restore on cleanup
  const previouslyFocused = returnFocus ?? (document.activeElement as HTMLElement | null);
  const addedContainerTabIndex = !container.hasAttribute('tabindex');

  if (addedContainerTabIndex) {
    container.setAttribute('tabindex', '-1');
  }

  const trap: ActiveFocusTrap = {
    container,
    initialFocus,
    previouslyFocused,
    onEscape,
    addedContainerTabIndex,
  };

  activeTraps.push(trap);
  ensureDocumentListeners();

  // Focus initial element after a small delay for animations
  requestAnimationFrame(() => {
    if (getTopTrap() === trap) {
      focusInitial(trap);
    }
  });

  let cleanedUp = false;

  // Return cleanup function
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;

    const index = activeTraps.indexOf(trap);
    if (index !== -1) {
      activeTraps.splice(index, 1);
    }

    cleanupDocumentListeners();

    if (trap.addedContainerTabIndex) {
      trap.container.removeAttribute('tabindex');
    }

    // Return focus to previously focused element
    if (trap.previouslyFocused && document.body.contains(trap.previouslyFocused)) {
      trap.previouslyFocused.focus({ preventScroll: true });
    }

    const nextTrap = getTopTrap();
    if (nextTrap && !nextTrap.container.contains(document.activeElement)) {
      requestAnimationFrame(() => focusInitial(nextTrap));
    }
  };
}
