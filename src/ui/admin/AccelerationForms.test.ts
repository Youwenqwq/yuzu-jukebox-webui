import { describe, expect, it } from 'vitest';
import { emptyDraft, validateDraft, type AccelerationDraft } from './AccelerationForms';

/** 校验只关心命中了哪条规则，翻译层直接回显 key。 */
const t = (key: string) => key;

function draft(patch: Partial<AccelerationDraft> = {}): AccelerationDraft {
  return {
    ...emptyDraft(),
    id: 'edge-main',
    name: 'EdgeOne',
    controlBaseUrl: 'https://edge.test/control',
    backendBaseUrl: 'https://edge.test/backend',
    ...patch,
  };
}

describe('validateDraft cache policy', () => {
  it('accepts the defaults', () => {
    expect(validateDraft(draft(), t, true)).toEqual({});
  });

  it('allows a zero horizon but rejects negatives and values past the server bound', () => {
    expect(
      validateDraft(draft({ cacheMode: 'prefetch_and_heat', prefetchHorizon: '0' }), t, true).prefetchHorizon,
    ).toBeUndefined();
    expect(validateDraft(draft({ prefetchHorizon: '20' }), t, true).prefetchHorizon).toBeUndefined();
    expect(validateDraft(draft({ prefetchHorizon: '-1' }), t, true).prefetchHorizon).toBe(
      'admin.acceleration.invalidPrefetchHorizon',
    );
    expect(validateDraft(draft({ prefetchHorizon: '21' }), t, true).prefetchHorizon).toBe(
      'admin.acceleration.invalidPrefetchHorizon',
    );
  });

  /**
   * 仅待播模式的需求集合只有队列视界，视界 0 = 启用了却什么都不缓存；
   * prefetch_and_heat 下 0 仍合法，表示只要热度、不做待播钉住。
   */
  it('requires a non-zero horizon only in prefetch mode', () => {
    expect(
      validateDraft(draft({ cacheMode: 'prefetch', prefetchHorizon: '0' }), t, true).prefetchHorizon,
    ).toBe('admin.acceleration.invalidPrefetchHorizonZero');
    expect(
      validateDraft(draft({ cacheMode: 'prefetch_and_heat', prefetchHorizon: '0' }), t, true).prefetchHorizon,
    ).toBeUndefined();
    expect(
      validateDraft(draft({ cacheMode: 'prefetch', prefetchHorizon: '1' }), t, true).prefetchHorizon,
    ).toBeUndefined();
  });

  it('keeps the share inside 1..100', () => {
    expect(validateDraft(draft({ prefetchSharePercent: '0' }), t, true).prefetchSharePercent).toBe(
      'admin.acceleration.invalidPercent',
    );
    expect(validateDraft(draft({ prefetchSharePercent: '101' }), t, true).prefetchSharePercent).toBe(
      'admin.acceleration.invalidPercent',
    );
  });

  /**
   * 钉住的待播对象 GC 动不了：份额上限越过低水位后回收目标永远够不到。
   * 该约束只在 prefetch_and_heat 生效——仅待播模式下份额本就不参与计算。
   */
  it('rejects a share above the low watermark only when heat is enabled', () => {
    const over = { storageLowWatermarkPercent: '85', prefetchSharePercent: '90' };
    expect(
      validateDraft(draft({ ...over, cacheMode: 'prefetch_and_heat' }), t, true).prefetchSharePercent,
    ).toBe('admin.acceleration.invalidPrefetchShareOverLow');
    expect(
      validateDraft(draft({ ...over, cacheMode: 'prefetch' }), t, true).prefetchSharePercent,
    ).toBeUndefined();
    expect(
      validateDraft(
        draft({ ...over, cacheMode: 'prefetch_and_heat', prefetchSharePercent: '85' }),
        t,
        true,
      ).prefetchSharePercent,
    ).toBeUndefined();
  });
});
