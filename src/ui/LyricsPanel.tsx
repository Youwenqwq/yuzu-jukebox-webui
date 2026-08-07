import { useEffect, useRef, type JSX } from 'react';
import type { LyricLine } from '../player/lyrics';

/**
 * 歌词面板：无框设计——舞台自身已是容器，面板透明嵌入。
 * 居中排版 + 上下渐隐遮罩引导视线到当前行；active 行用展示字体放大。
 * 高度由父容器决定（h-full）。
 */
export function LyricsPanel(props: {
  lines: LyricLine[];
  activeIndex: number;
  emptyText: string;
  /** 全屏播放页用大字级；舞台小预览默认小字级 */
  large?: boolean;
}): JSX.Element {
  const { lines, activeIndex, emptyText, large = false } = props;
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
      <div className="grid h-full place-items-center text-center text-sm text-faint">
        {emptyText}
      </div>
    );
  }

  return (
    <ol
      className="no-scrollbar h-full overflow-y-auto overscroll-contain text-center [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
    >
      {/* 顶部留白，让首行能滚到视口中部 */}
      <li aria-hidden className="h-[38%]" />
      {lines.map((line, index) => {
        const active = index === activeIndex;
        const near = Math.abs(index - activeIndex) === 1;
        return (
          <li
            key={`${line.timeMs}:${index}`}
            ref={(element) => {
              lineRefs.current[index] = element;
            }}
            aria-current={active ? 'true' : undefined}
            className={`px-6 py-2 transition-colors duration-[var(--speed)] ${
              active ? 'text-paper' : near ? 'text-muted' : 'text-faint'
            }`}
          >
            <p
              className={
                active
                  ? `font-display font-semibold leading-relaxed ${large ? 'text-2xl lg:text-3xl' : 'text-lg'}`
                  : `leading-relaxed ${large ? 'text-[15px]' : 'text-[13px]'}`
              }
            >
              {line.text}
            </p>
            {line.translation !== undefined && (
              <p
                className={`mt-0.5 leading-relaxed ${
                  active ? `text-muted ${large ? 'text-base' : 'text-[13px]'}` : large ? 'text-sm' : 'text-xs'
                }`}
              >
                {line.translation}
              </p>
            )}
          </li>
        );
      })}
      {/* 底部留白，让末行能滚到视口中部 */}
      <li aria-hidden className="h-[38%]" />
    </ol>
  );
}
