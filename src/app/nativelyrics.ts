/**
 * ColorOS 锁屏歌词桥（OPlus lyricInfo 协议）：歌词以 JSON 字符串挂在
 * MediaMetadata 的 lyricInfo 键，系统管线渲染锁屏逐行歌词。播放进度由
 * PlaybackState 提供，歌词字段只承载整首时间轴文本——不要把当前行
 * 反复写进它，也不要写进 TITLE/ARTIST 等曲目身份字段。
 *
 * 时序（协议 §5）：切歌先移除上一首 lyricInfo → 新歌词就绪带完整 payload
 * 提交一次 → 系统防抖窗口可能丢弃首次提交，800ms 后幂等补交一次。
 * 事件驱动，勿周期推送。
 */
import type { LyricsResult } from '../api/types';
import type { CurrentTrack } from '../protocol/types';

/** 与 YuzuMediaPlugin.setLyricInfo 对应。 */
export interface YuzuLyricsPluginHandle {
  setLyricInfo(options: { lyricInfo: string | null }): Promise<void>;
}

/** 时间轴校验：至少一个 [mm:ss.xx]（或 [mm:ss:xx]）标签，协议 §3 必填约束。 */
const TIMESTAMPED = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/;

/** 构建 lyricInfo JSON；无可用歌词（null/无时间标签）返回 null（保持移除态）。 */
export function buildLyricInfo(current: CurrentTrack, lyrics: LyricsResult | null): string | null {
  if (lyrics === null || lyrics.type !== 'lrc' || !TIMESTAMPED.test(lyrics.lrc)) {
    return null;
  }
  const info: Record<string, string> = {
    songName: current.title,
    artist: current.artist,
    songId: current.track_ref,
    lyric: lyrics.lrc,
  };
  if (lyrics.tlrc !== undefined && TIMESTAMPED.test(lyrics.tlrc)) {
    info.translationLyric = lyrics.tlrc;
  }
  return JSON.stringify(info);
}

export interface NativeLyricsSync {
  /** 当前曲目变化时调用（null = 离房/无曲目）：先清旧歌词，再异步取新歌词提交。 */
  sync(current: CurrentTrack | null): void;
}

/** 可注入插件与取词函数的工厂：测试用 fake，生产由模块级单例注入。 */
export function createNativeLyricsSync(
  plugin: YuzuLyricsPluginHandle,
  fetchLyrics: (trackRef: string) => Promise<LyricsResult | null>,
): NativeLyricsSync {
  let currentRef: string | null = null;
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const push = (lyricInfo: string | null): void => {
    void plugin.setLyricInfo({ lyricInfo }).catch(() => {});
  };

  return {
    sync(current) {
      const ref = current?.track_ref ?? null;
      if (ref === currentRef) return; // 同曲目幂等（store 高频 publish）
      currentRef = ref;
      const mySeq = ++seq;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      // 协议 §5.2：切歌立即移除上一首歌词，避免旧词匹配新曲
      push(null);
      if (current === null || ref === null) return;

      void (async () => {
        let lyrics: LyricsResult | null;
        try {
          lyrics = await fetchLyrics(ref);
        } catch {
          return; // 拉取失败保持移除态，不重试（切歌会再次触发）
        }
        if (mySeq !== seq) return; // 拉取期间已切歌
        const payload = buildLyricInfo(current, lyrics);
        if (payload === null) return; // 无歌词：保持移除态
        push(payload);
        // 协议 §5.6：防抖窗口可能吞掉首次提交，800ms 后幂等补交一次
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (mySeq === seq) push(payload);
        }, 800);
      })();
    },
  };
}
