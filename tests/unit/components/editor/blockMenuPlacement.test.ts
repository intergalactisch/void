import { describe, expect, it } from 'vitest';
import { calculateBlockMenuPlacement } from '$lib/components/editor/blockMenuPlacement';

describe('calculateBlockMenuPlacement', () => {
  it('opens below when there is enough room', () => {
    const placement = calculateBlockMenuPlacement(
      { top: 80, left: 120 },
      { width: 208, height: 300 },
      { width: 1024, height: 768 },
    );

    expect(placement.openAbove).toBe(false);
    expect(placement.top).toBe(88);
    expect(placement.left).toBe(120);
    expect(placement.maxHeight).toBe(300);
  });

  it('opens above near the viewport bottom', () => {
    const placement = calculateBlockMenuPlacement(
      { top: 720, left: 120 },
      { width: 208, height: 300 },
      { width: 1024, height: 768 },
    );

    expect(placement.openAbove).toBe(true);
    expect(placement.top).toBe(412);
    expect(placement.maxHeight).toBe(300);
  });

  it('clamps horizontally and constrains height on tiny viewports', () => {
    const placement = calculateBlockMenuPlacement(
      { top: 170, left: 500 },
      { width: 208, height: 360 },
      { width: 240, height: 220 },
    );

    expect(placement.openAbove).toBe(true);
    expect(placement.left).toBe(24);
    expect(placement.top).toBe(8);
    expect(placement.maxHeight).toBeLessThan(360);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(212);
  });
});
