import { describe, expect, it } from 'vitest';
import { resolveDropPlacement, resolvePaneDropPreview } from '$lib/components/editor/paneMove';

const targetRect = {
  left: 100,
  top: 80,
  width: 400,
  height: 300,
};

describe('pane drop placement resolver', () => {
  it('resolves the inner box as a center drop', () => {
    expect(resolveDropPlacement({ x: 300, y: 230 }, targetRect)).toBe('center');
    // Still center near the former edge thresholds (inside the 0.28 inset).
    expect(resolveDropPlacement({ x: 235, y: 230 }, targetRect)).toBe('center');
    expect(resolveDropPlacement({ x: 300, y: 185 }, targetRect)).toBe('center');
  });

  it('resolves edges by nearest border', () => {
    expect(resolveDropPlacement({ x: 150, y: 230 }, targetRect)).toBe('left');
    expect(resolveDropPlacement({ x: 450, y: 230 }, targetRect)).toBe('right');
    expect(resolveDropPlacement({ x: 300, y: 120 }, targetRect)).toBe('top');
    expect(resolveDropPlacement({ x: 300, y: 340 }, targetRect)).toBe('bottom');
  });

  it('chooses the nearest edge in corner regions', () => {
    expect(resolveDropPlacement({ x: 115, y: 160 }, targetRect)).toBe('left');
    expect(resolveDropPlacement({ x: 150, y: 88 }, targetRect)).toBe('top');
  });
});

describe('pane drop preview', () => {
  it('previews a center drop over the whole pane with no survivor half', () => {
    const preview = resolvePaneDropPreview({ x: 300, y: 230 }, targetRect, { kind: 'pane' });
    expect(preview.placement).toBe('center');
    expect(preview.label).toBe('Swap');
    expect(preview.previewRect).toEqual(targetRect);
    expect(preview.survivorRect).toBeNull();
  });

  it('labels a center note drop as Replace', () => {
    const preview = resolvePaneDropPreview({ x: 300, y: 230 }, targetRect, { kind: 'note' });
    expect(preview.placement).toBe('center');
    expect(preview.label).toBe('Replace');
  });

  it('splits the target into insertion and surviving halves for edge drops', () => {
    const left = resolvePaneDropPreview({ x: 150, y: 230 }, targetRect, { kind: 'note' });
    expect(left.placement).toBe('left');
    expect(left.label).toBe('Open left');
    expect(left.previewRect).toEqual({ left: 100, top: 80, width: 200, height: 300 });
    expect(left.survivorRect).toEqual({ left: 300, top: 80, width: 200, height: 300 });

    const bottom = resolvePaneDropPreview({ x: 300, y: 340 }, targetRect, { kind: 'pane' });
    expect(bottom.placement).toBe('bottom');
    expect(bottom.label).toBe('Move down');
    expect(bottom.previewRect).toEqual({ left: 100, top: 230, width: 400, height: 150 });
    expect(bottom.survivorRect).toEqual({ left: 100, top: 80, width: 400, height: 150 });
  });

  it('labels an already-open note drop distinctly', () => {
    const preview = resolvePaneDropPreview({ x: 150, y: 230 }, targetRect, { kind: 'note', alreadyOpen: true });
    expect(preview.placement).toBe('left');
    expect(preview.label).toBe('Already open');
  });
});
