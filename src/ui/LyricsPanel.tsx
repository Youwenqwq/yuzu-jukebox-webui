import { useEffect, useRef, type JSX } from 'react';
import type { LyricLine } from '../player/lyrics';

export function LyricsPanel(props: {
  lines: LyricLine[];
  activeIndex: number;
  emptyText: string;
}): JSX.Element {
  const { lines, activeIndex, emptyText } = props;
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const activeLine = lineRefs.current[activeIndex];
    if (!activeLine) {
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeLine.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [activeIndex]);

  if (lines.length === 0) {
    return (
      <div className="grid min-h-52 place-items-center rounded-lg border border-hairline bg-panel px-6 py-12 text-center text-sm text-faint">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-hairline bg-panel shadow-[inset_0_1px_0_var(--hover)]">
      <div className="pointer-events-none absolute inset-x-4 top-3 z-10 border-t border-dashed border-hairline" />
      <ol className="max-h-[min(56vh,32rem)] overflow-y-auto scroll-py-[45%] px-5 py-12 sm:px-8">
        {lines.map((line, index) => {
          const active = index === activeIndex;
          return (
            <li
              key={`${line.timeMs}:${index}`}
              ref={(element) => {
                lineRefs.current[index] = element;
              }}
              aria-current={active ? 'true' : undefined}
              className={`relative border-l py-3 pl-5 transition-[color,font-size,opacity,transform] duration-[var(--speed)] sm:pl-7 ${
                active
                  ? 'translate-x-1 border-accent text-base text-paper opacity-100 sm:text-lg'
                  : 'border-hairline text-sm text-faint opacity-70'
              }`}
            >
              <p className={active ? 'font-display font-semibold leading-relaxed' : 'leading-relaxed'}>
                {line.text}
              </p>
              {line.translation !== undefined && (
                <p className={`mt-1 leading-relaxed ${active ? 'text-sm text-muted' : 'text-xs text-faint'}`}>
                  {line.translation}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="pointer-events-none absolute inset-x-4 bottom-3 z-10 border-b border-dashed border-hairline" />
    </div>
  );
}
