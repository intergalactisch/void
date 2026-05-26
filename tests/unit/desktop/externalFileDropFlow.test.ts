import { describe, expect, it } from 'vitest';
import {
  formatExternalDropImageLabel,
  formatExternalDropMarkdownLabel,
  formatExternalDropSkippedLabel,
  isExternalImagePath,
  isExternalMarkdownPath,
  normalizeExternalFilePath,
  summarizeExternalFileDropPaths,
} from '$lib/desktop/externalFileDropFlow';

describe('externalFileDropFlow', () => {
  it('classifies markdown-only drops', () => {
    const summary = summarizeExternalFileDropPaths(['/tmp/a.md', '/tmp/B.MD']);

    expect(summary).toMatchObject({
      totalCount: 2,
      markdownCount: 2,
      imageCount: 0,
      unsupportedCount: 0,
      state: 'markdown',
    });
    expect(summary.markdownPaths).toEqual(['/tmp/a.md', '/tmp/B.MD']);
  });

  it('classifies supported image-only drops case-insensitively', () => {
    const summary = summarizeExternalFileDropPaths([
      '/tmp/chart.PNG',
      '/tmp/photo.JPEG',
      '/tmp/icon.svg',
      '/tmp/loop.GIF',
      '/tmp/card.WEBP',
    ]);

    expect(summary).toMatchObject({
      markdownCount: 0,
      imageCount: 5,
      unsupportedCount: 0,
      state: 'image',
    });
  });

  it('classifies mixed markdown, image, and unsupported drops', () => {
    const summary = summarizeExternalFileDropPaths(['/tmp/a.md', '/tmp/chart.png', '/tmp/data.csv']);

    expect(summary).toMatchObject({
      markdownCount: 1,
      imageCount: 1,
      unsupportedCount: 1,
      state: 'mixed',
    });
    expect(summary.markdownPaths).toEqual(['/tmp/a.md']);
    expect(summary.imagePaths).toEqual(['/tmp/chart.png']);
    expect(summary.unsupportedPaths).toEqual(['/tmp/data.csv']);
  });

  it('marks unsupported-only drops invalid', () => {
    const summary = summarizeExternalFileDropPaths(['/tmp/a.markdown', '/tmp/a.txt']);

    expect(summary).toMatchObject({
      markdownCount: 0,
      imageCount: 0,
      unsupportedCount: 2,
      state: 'invalid',
    });
  });

  it('handles file URLs and display labels', () => {
    const summary = summarizeExternalFileDropPaths([
      'file:///tmp/dit%20is%20een%20test.md',
      'file:///tmp/chart%20one.PNG',
      'file:///tmp/not%20this.txt',
    ]);

    expect(normalizeExternalFilePath('file:///tmp/chart%20one.PNG')).toBe('/tmp/chart one.PNG');
    expect(isExternalMarkdownPath('file:///tmp/dit%20is%20een%20test.md')).toBe(true);
    expect(isExternalImagePath('file:///tmp/chart%20one.PNG')).toBe(true);
    expect(formatExternalDropMarkdownLabel(summary)).toBe('dit is een test.md');
    expect(formatExternalDropImageLabel(summary)).toBe('chart one.PNG');
    expect(formatExternalDropSkippedLabel(summary)).toBe('not this.txt skipped');
  });

  it('formats batch labels', () => {
    const summary = summarizeExternalFileDropPaths([
      '/tmp/a.md',
      '/tmp/b.md',
      '/tmp/a.png',
      '/tmp/b.webp',
      '/tmp/c.txt',
      '/tmp/d.csv',
    ]);

    expect(formatExternalDropMarkdownLabel(summary)).toBe('2 Markdown files');
    expect(formatExternalDropImageLabel(summary)).toBe('2 images');
    expect(formatExternalDropSkippedLabel(summary)).toBe('2 skipped');
  });
});
