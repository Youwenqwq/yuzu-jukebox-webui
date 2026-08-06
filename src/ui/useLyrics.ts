import { useEffect, useState } from 'react';
import { api } from '../app/session';
import { parseLrc, type LyricLine } from '../player/lyrics';

/** 当前曲目歌词：换曲重新拉取；桌面播放栏与移动播放条共用（全屏播放页消费）。 */
export function useLyrics(trackRef: string | undefined): {
  lines: LyricLine[] | null;
  loading: boolean;
} {
  const [lines, setLines] = useState<LyricLine[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLines(null);
    if (!trackRef) return;
    let dead = false;
    setLoading(true);
    api
      .lyrics(trackRef)
      .then((res) => {
        if (!dead) setLines(res ? parseLrc(res.lrc, res.tlrc) : []);
      })
      .catch(() => {
        if (!dead) setLines([]);
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [trackRef]);

  return { lines, loading };
}
