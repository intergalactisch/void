import { describe, expect, it } from 'vitest';
import { resolvePaneMovePreview } from '$lib/components/editor/paneMove';

const targetRect = {
  left: 100,
  top: 80,
  width: 400,
  height: 300,
};

describe('pane move preview resolver', () => {
  it('resolves center as a swap preview over the full target pane', () => {
    const preview = resolvePaneMovePreview({ x: 300, y: 230 }, targetRect);

    expect(preview.intent).toBe('swap');
    expect(preview.label).toBe('Swap panes');
    expect(preview.previewRect).toEqual(targetRect);
  });

  it('resolves left and right thirds to half-width rectangles', () => {
    const left = resolvePaneMovePreview({ x: 225, y: 230 }, targetRect);
    const right = resolvePaneMovePreview({ x: 375, y: 230 }, targetRect);

    expect(left.intent).toBe('left');
    expect(left.previewRect).toEqual({ left: 100, top: 80, width: 200, height: 300 });
    expect(right.intent).toBe('right');
    expect(right.previewRect).toEqual({ left: 300, top: 80, width: 200, height: 300 });
  });

  it('uses final equalized layout slots when reflow slot metadata is provided', () => {
    const preview = resolvePaneMovePreview({ x: 375, y: 230 }, targetRect, {
      right: {
        index: 2,
        count: 3,
        layoutRect: { left: 20, top: 40, width: 900, height: 500 },
      },
    });

    expect(preview.intent).toBe('right');
    expect(preview.previewRect).toEqual({
      left: 620,
      top: 40,
      width: 300,
      height: 500,
    });
  });

  it('resolves top and bottom thirds to half-height rectangles', () => {
    const top = resolvePaneMovePreview({ x: 300, y: 175 }, targetRect);
    const bottom = resolvePaneMovePreview({ x: 300, y: 285 }, targetRect);

    expect(top.intent).toBe('top');
    expect(top.previewRect).toEqual({ left: 100, top: 80, width: 400, height: 150 });
    expect(bottom.intent).toBe('bottom');
    expect(bottom.previewRect).toEqual({ left: 100, top: 230, width: 400, height: 150 });
  });

  it('keeps the middle third as swap even near the former edge threshold', () => {
    const centerLeftBoundary = resolvePaneMovePreview({ x: 235, y: 230 }, targetRect);
    const centerTopBoundary = resolvePaneMovePreview({ x: 300, y: 185 }, targetRect);

    expect(centerLeftBoundary.intent).toBe('swap');
    expect(centerTopBoundary.intent).toBe('swap');
  });

  it('chooses the nearest edge in corner thirds', () => {
    const leftCorner = resolvePaneMovePreview({ x: 115, y: 160 }, targetRect);
    const topCorner = resolvePaneMovePreview({ x: 150, y: 88 }, targetRect);

    expect(leftCorner.intent).toBe('left');
    expect(topCorner.intent).toBe('top');
  });
});
