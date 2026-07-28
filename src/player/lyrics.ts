export interface LyricLine {
  timeMs: number;
  text: string;
  translation?: string;
}

// Standard LRC uses [mm:ss.xx]; NCM and some Chinese sources use [mm:ss:xx].
const TIMESTAMP_PATTERN = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_PATTERN = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im;

interface ParsedTrackLine {
  timeMs: number;
  text: string;
  order: number;
}

function parseTrack(source: string): ParsedTrackLine[] {
  const offsetMatch = OFFSET_PATTERN.exec(source);
  const offsetMs = offsetMatch ? Number(offsetMatch[1]) : 0;
  const parsed: ParsedTrackLine[] = [];
  let order = 0;

  for (const sourceLine of source.split(/\r?\n/)) {
    const timestamps = Array.from(sourceLine.matchAll(TIMESTAMP_PATTERN));
    if (timestamps.length === 0) {
      continue;
    }

    const text = sourceLine.slice(timestamps[timestamps.length - 1].index! + timestamps[timestamps.length - 1][0].length).trim();
    for (const timestamp of timestamps) {
      const minutes = Number(timestamp[1]);
      const seconds = Number(timestamp[2]);
      const fractionMs = Number((timestamp[3] ?? '').padEnd(3, '0'));
      parsed.push({
        timeMs: minutes * 60_000 + seconds * 1_000 + fractionMs - offsetMs,
        text,
        order,
      });
      order += 1;
    }
  }

  parsed.sort((left, right) => left.timeMs - right.timeMs || left.order - right.order);
  return parsed;
}

/**
 * Parses an LRC track and merges an optional translated LRC track by timestamp.
 * Positive `[offset:]` values move the entire corresponding track earlier.
 */
export function parseLrc(lrc: string, tlrc?: string): LyricLine[] {
  const lines = parseTrack(lrc);
  if (tlrc === undefined) {
    return lines.map(({ timeMs, text }) => ({ timeMs, text }));
  }

  const translations = new Map<number, string>();
  for (const line of parseTrack(tlrc)) {
    if (!translations.has(line.timeMs)) {
      translations.set(line.timeMs, line.text);
    }
  }

  return lines.map(({ timeMs, text }) => {
    const translation = translations.get(timeMs);
    return translation === undefined ? { timeMs, text } : { timeMs, text, translation };
  });
}

/** Returns the last lyric line whose timestamp is not after `positionMs`. */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let active = -1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (lines[middle].timeMs <= positionMs) {
      active = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return active;
}
