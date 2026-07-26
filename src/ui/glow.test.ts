import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractGlowColors } from './glow';

function installCanvas(data: number[]) {
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(data) }));
  const createElement = vi.fn(() => ({
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage, getImageData })),
  }));
  vi.stubGlobal('document', { createElement });
  return { createElement, drawImage, getImageData };
}

function image(url: string): HTMLImageElement {
  return { currentSrc: url, src: url } as HTMLImageElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractGlowColors', () => {
  it('returns the means of the two largest hue clusters and caches them by URL', () => {
    const canvas = installCanvas([
      220, 40, 30, 255,
      200, 20, 20, 255,
      30, 80, 220, 255,
      128, 128, 128, 255,
      250, 250, 250, 255,
    ]);
    const cover = image('https://jukebox.test/api/v1/cover/one');

    const first = extractGlowColors(cover);
    const second = extractGlowColors(image(cover.src));

    expect(first).toEqual(['#d21e19', '#1e50dc']);
    expect(second).toEqual(first);
    expect(canvas.createElement).toHaveBeenCalledTimes(1);
    expect(canvas.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.getImageData).toHaveBeenCalledTimes(1);
  });

  it('returns null when a polluted canvas rejects pixel reads', () => {
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => {
      throw new DOMException('The canvas has been tainted', 'SecurityError');
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => ({ drawImage, getImageData })),
      })),
    });

    expect(extractGlowColors(image('https://cdn.test/cross-origin-cover'))).toBeNull();
  });
});
