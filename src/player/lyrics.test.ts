import { describe, expect, it } from 'vitest';
import { activeLineIndex, parseLrc, type LyricLine } from './lyrics';

describe('parseLrc', () => {
  it('parses a standard timestamped line', () => {
    expect(parseLrc('[00:12.34]柚子汽水')).toEqual([
      { timeMs: 12_340, text: '柚子汽水' },
    ]);
  });

  it('expands multiple timestamps on one line', () => {
    expect(parseLrc('[00:01.00][00:03.50]再唱一次')).toEqual([
      { timeMs: 1_000, text: '再唱一次' },
      { timeMs: 3_500, text: '再唱一次' },
    ]);
  });

  it('ignores metadata and applies a positive offset by moving lyrics earlier', () => {
    const source = [
      '[ti:夜航]',
      '[ar:柚子乐队]',
      '[al:留声机]',
      '[offset:250]',
      '[00:01.00]启程',
    ].join('\n');

    expect(parseLrc(source)).toEqual([
      { timeMs: 750, text: '启程' },
    ]);
  });

  it('skips lines without timestamps', () => {
    expect(parseLrc('这行没有时间\n[00:02.00]这一行保留')).toEqual([
      { timeMs: 2_000, text: '这一行保留' },
    ]);
  });

  it('merges translated lyrics at matching timestamps', () => {
    const lrc = '[00:01.00]First line\n[00:02.00]Second line';
    const tlrc = '[00:01.00]第一行\n[00:02.00]第二行';

    expect(parseLrc(lrc, tlrc)).toEqual([
      { timeMs: 1_000, text: 'First line', translation: '第一行' },
      { timeMs: 2_000, text: 'Second line', translation: '第二行' },
    ]);
  });

  it('sorts out-of-order input by timestamp', () => {
    expect(parseLrc('[00:09.00]末句\n[00:01.00]首句\n[00:05.00]中句')).toEqual([
      { timeMs: 1_000, text: '首句' },
      { timeMs: 5_000, text: '中句' },
      { timeMs: 9_000, text: '末句' },
    ]);
  });
});

describe('activeLineIndex', () => {
  const lines: LyricLine[] = [
    { timeMs: 1_000, text: '首句' },
    { timeMs: 3_000, text: '中句' },
    { timeMs: 5_000, text: '末句' },
  ];

  it('returns -1 before the first line', () => {
    expect(activeLineIndex(lines, 999)).toBe(-1);
  });

  it('selects a line exactly at its timestamp', () => {
    expect(activeLineIndex(lines, 3_000)).toBe(1);
  });

  it('keeps the preceding line between timestamps', () => {
    expect(activeLineIndex(lines, 4_999)).toBe(1);
  });

  it('selects the final line after the lyrics end', () => {
    expect(activeLineIndex(lines, 99_000)).toBe(2);
  });

  it('returns -1 for an empty lyric list', () => {
    expect(activeLineIndex([], 10_000)).toBe(-1);
  });
});
