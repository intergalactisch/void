export interface TextareaAutosizer {
  schedule(element: HTMLTextAreaElement | null | undefined): void;
  reset(element: HTMLTextAreaElement | null | undefined): void;
  cancel(): void;
}

export function createTextareaAutosizer(maxHeight: number): TextareaAutosizer {
  let frame: number | ReturnType<typeof setTimeout> | null = null;
  let pendingElement: HTMLTextAreaElement | null = null;

  function clearFrame() {
    if (frame === null) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame as number);
    } else {
      clearTimeout(frame as ReturnType<typeof setTimeout>);
    }
    frame = null;
  }

  function run() {
    frame = null;
    const element = pendingElement;
    pendingElement = null;
    if (!element) return;

    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  }

  function requestRun() {
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(run);
      return;
    }
    frame = setTimeout(run, 0);
  }

  return {
    schedule(element) {
      if (!element) return;
      pendingElement = element;
      if (frame !== null) return;
      requestRun();
    },
    reset(element) {
      clearFrame();
      pendingElement = null;
      if (element) element.style.height = 'auto';
    },
    cancel() {
      clearFrame();
      pendingElement = null;
    },
  };
}
