const SAMPLE_SIZE = 16;
const HUE_BUCKET_DEGREES = 30;
const HUE_BUCKET_COUNT = 360 / HUE_BUCKET_DEGREES;
const glowCache = new Map<string, [string, string] | null>();

interface ColorCluster {
  count: number;
  red: number;
  green: number;
  blue: number;
}

function hueOf(red: number, green: number, blue: number, max: number, delta: number): number {
  if (max === red) {
    return (60 * ((green - blue) / delta) + 360) % 360;
  }
  if (max === green) {
    return 60 * ((blue - red) / delta + 2);
  }
  return 60 * ((red - green) / delta + 4);
}

function toHex(cluster: ColorCluster): string {
  const channel = (sum: number) => Math.round(sum / cluster.count).toString(16).padStart(2, '0');
  return `#${channel(cluster.red)}${channel(cluster.green)}${channel(cluster.blue)}`;
}

/** 从封面图提取两个辉光色；跨域污染/加载失败 → null（调用方保持现状） */
export function extractGlowColors(img: HTMLImageElement): [string, string] | null {
  const url = img.currentSrc || img.src;
  if (url && glowCache.has(url)) {
    return glowCache.get(url) ?? null;
  }

  let result: [string, string] | null = null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (context) {
      context.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      const clusters = new Map<number, ColorCluster>();

      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const delta = max - min;

        if (alpha < 128 || max < 28 || min > 232 || delta < 20) {
          continue;
        }

        const lightness = (max + min) / 510;
        const saturation = delta / 255 / (1 - Math.abs(2 * lightness - 1));
        if (!Number.isFinite(saturation) || saturation < 0.2) {
          continue;
        }

        const hue = hueOf(red, green, blue, max, delta);
        const bucket = Math.floor((hue + HUE_BUCKET_DEGREES / 2) / HUE_BUCKET_DEGREES) % HUE_BUCKET_COUNT;
        const cluster = clusters.get(bucket);

        if (cluster) {
          cluster.count += 1;
          cluster.red += red;
          cluster.green += green;
          cluster.blue += blue;
        } else {
          clusters.set(bucket, { count: 1, red, green, blue });
        }
      }

      const dominant = [...clusters.values()].sort((left, right) => right.count - left.count).slice(0, 2);
      if (dominant.length > 0) {
        const first = toHex(dominant[0]);
        result = [first, dominant[1] ? toHex(dominant[1]) : first];
      }
    }
  } catch {
    result = null;
  }

  if (url) {
    glowCache.set(url, result);
  }
  return result;
}
