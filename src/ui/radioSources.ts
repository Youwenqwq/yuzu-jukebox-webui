/**
 * 电台源目录的共享工具：RadioPanel（抽屉）与首页电台卡共用。
 * 目录本身来自 provider 能力报告（capabilities.radio_sources），前端不硬编码规格。
 */
import type { ProviderInfo, RadioSourceInfo } from '../api/types';

/** 已知源规格的补充描述（name 由服务端给；desc 是纯文案，按 spec 键本地补充） */
export const SOURCE_DESC_KEYS: Record<string, string> = {
  daily: 'radio.presetDailyDesc',
  fm: 'radio.presetFmDesc',
  heart: 'radio.presetHeartDesc',
  simi: 'radio.presetSimiDesc',
};

/**
 * 组装源规格：`<provider>:<spec>`，带 arg 时追加参数。
 * - arg = track_id：种子 = 当前播放的同 provider 曲目，缺失返回 null（禁用入口）
 * - 其余 arg（playlist_id / media_id 等）：由调用方按上下文经 argValue 提供
 */
export function composeSource(
  providerId: string,
  source: RadioSourceInfo,
  currentRef: string | undefined,
  argValue?: string,
): string | null {
  if (!source.arg) return `${providerId}:${source.spec}`;
  if (source.arg === 'track_id') {
    const prefix = `${providerId}:`;
    const seed = currentRef?.startsWith(prefix) ? currentRef.slice(prefix.length) : null;
    return seed === null ? null : `${providerId}:${source.spec}:${seed}`;
  }
  return argValue ? `${providerId}:${source.spec}:${argValue}` : null;
}

/**
 * 外部歌单实体对应的电台源目录条目（ncm playlist:<id> / bili fav:<media_id>）。
 * 命中则任何有电台权限的用户都能把搜索到的歌单实体直接作电台播放，无需导入。
 */
export function entityRadioSource(
  providers: ProviderInfo[] | null,
  providerId: string,
): RadioSourceInfo | null {
  const catalog =
    providers?.find((p) => p.id === providerId)?.capabilities?.radio_sources ?? [];
  return catalog.find((s) => s.arg !== undefined && s.arg !== '' && s.arg !== 'track_id') ?? null;
}
