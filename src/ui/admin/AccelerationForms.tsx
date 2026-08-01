/**
 * 加速资源的新建 / 编辑表单。
 *
 * 两个表单共用同一份草稿模型与校验规则：草稿全部以字符串保存（数字输入清空时
 * 不会被 Number('') 打成 0），提交时才转成数字。校验规则逐条对齐服务端
 * `internal/httpapi/accelerations.go` 的 create/update 约束——原来这些约束只在
 * 提交后以一句笼统的 400 文案返回，用户无从知道是哪一格填错。
 */
import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import type {
  AccelerationCacheMode,
  AccelerationInfo,
  CreateAccelerationInput,
  UpdateAccelerationInput,
} from '../../api/types';
import { formatBytes } from '../format';
import { Select } from '../primitives';
import {
  formatRate,
  formatSeconds,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type Translate,
} from './accelerationShared';

export interface AccelerationDraft {
  id: string;
  name: string;
  controlBaseUrl: string;
  backendBaseUrl: string;
  cacheMode: AccelerationCacheMode;
  prefetchHorizon: string;
  prefetchSharePercent: string;
  leaseTtlSeconds: string;
  uploadRateBytesPerSecond: string;
  maxObjectBytes: string;
  storageBudgetBytes: string;
  storageHighWatermarkPercent: string;
  storageLowWatermarkPercent: string;
  inventoryIntervalSeconds: string;
  inventoryStaleAfterSeconds: string;
}

type DraftErrors = Partial<Record<keyof AccelerationDraft, string>>;

const MIB = 1024 * 1024;

/** 服务端 validateAccelerationCachePolicy 的硬上界，越界会被 400 拒绝。 */
const MAX_PREFETCH_HORIZON = 20;

/** 默认值对齐服务端 create 缺省（850 MiB 容量 / 23 MiB 单对象 / 95%-85% 水位 / 待播+热度 2 首 20%）。 */
export function emptyDraft(): AccelerationDraft {
  return {
    id: '',
    name: '',
    controlBaseUrl: '',
    backendBaseUrl: '',
    cacheMode: 'prefetch_and_heat',
    prefetchHorizon: '2',
    prefetchSharePercent: '20',
    leaseTtlSeconds: '600',
    uploadRateBytesPerSecond: '187500',
    maxObjectBytes: String(23 * MIB),
    storageBudgetBytes: String(850 * MIB),
    storageHighWatermarkPercent: '95',
    storageLowWatermarkPercent: '85',
    inventoryIntervalSeconds: '900',
    inventoryStaleAfterSeconds: '1800',
  };
}

export function draftFromAcceleration(acceleration: AccelerationInfo): AccelerationDraft {
  return {
    id: acceleration.id,
    name: acceleration.name,
    controlBaseUrl: acceleration.control_base_url,
    backendBaseUrl: acceleration.backend_base_url,
    cacheMode: acceleration.cache_mode,
    prefetchHorizon: String(acceleration.prefetch_horizon),
    prefetchSharePercent: String(acceleration.prefetch_share_percent),
    leaseTtlSeconds: String(acceleration.lease_ttl_seconds),
    uploadRateBytesPerSecond: String(acceleration.upload_rate_bytes_per_second),
    maxObjectBytes: String(acceleration.max_object_bytes),
    storageBudgetBytes: String(acceleration.storage_budget_bytes),
    storageHighWatermarkPercent: String(acceleration.storage_high_watermark_percent),
    storageLowWatermarkPercent: String(acceleration.storage_low_watermark_percent),
    inventoryIntervalSeconds: String(acceleration.inventory_interval_seconds),
    inventoryStaleAfterSeconds: String(acceleration.inventory_stale_after_seconds),
  };
}

/** 创建请求体：字段集合与原实现完全一致（不带 kind，由服务端默认 edgeone）。 */
export function toCreateInput(draft: AccelerationDraft): CreateAccelerationInput {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    control_base_url: draft.controlBaseUrl.trim(),
    backend_base_url: draft.backendBaseUrl.trim(),
    cache_mode: draft.cacheMode,
    prefetch_horizon: Number(draft.prefetchHorizon),
    prefetch_share_percent: Number(draft.prefetchSharePercent),
    lease_ttl_seconds: Number(draft.leaseTtlSeconds),
    upload_rate_bytes_per_second: Number(draft.uploadRateBytesPerSecond),
    max_object_bytes: Number(draft.maxObjectBytes),
    storage_budget_bytes: Number(draft.storageBudgetBytes),
    storage_high_watermark_percent: Number(draft.storageHighWatermarkPercent),
    storage_low_watermark_percent: Number(draft.storageLowWatermarkPercent),
    inventory_interval_seconds: Number(draft.inventoryIntervalSeconds),
    inventory_stale_after_seconds: Number(draft.inventoryStaleAfterSeconds),
  };
}

/** 更新请求体：与原 openEdit 相同的字段集，enabled 仍由启用/停用单独提交。 */
export function toUpdateInput(draft: AccelerationDraft): UpdateAccelerationInput {
  return {
    name: draft.name.trim(),
    cache_mode: draft.cacheMode,
    prefetch_horizon: Number(draft.prefetchHorizon),
    prefetch_share_percent: Number(draft.prefetchSharePercent),
    control_base_url: draft.controlBaseUrl.trim(),
    backend_base_url: draft.backendBaseUrl.trim(),
    lease_ttl_seconds: Number(draft.leaseTtlSeconds),
    upload_rate_bytes_per_second: Number(draft.uploadRateBytesPerSecond),
    max_object_bytes: Number(draft.maxObjectBytes),
    storage_budget_bytes: Number(draft.storageBudgetBytes),
    storage_high_watermark_percent: Number(draft.storageHighWatermarkPercent),
    storage_low_watermark_percent: Number(draft.storageLowWatermarkPercent),
    inventory_interval_seconds: Number(draft.inventoryIntervalSeconds),
    inventory_stale_after_seconds: Number(draft.inventoryStaleAfterSeconds),
  };
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** 端点规则对齐服务端 validateAccelerationURL。 */
function urlError(raw: string, t: Translate): string | undefined {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return t('admin.acceleration.invalidUrl');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return t('admin.acceleration.invalidUrl');
  }
  if (!parsed.host || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return t('admin.acceleration.invalidUrl');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (host === 'localhost' || isIp))) {
    return t('admin.acceleration.invalidUrl');
  }
  return undefined;
}

export function validateDraft(draft: AccelerationDraft, t: Translate, withId: boolean): DraftErrors {
  const errors: DraftErrors = {};

  if (withId && !ID_PATTERN.test(draft.id.trim())) errors.id = t('admin.acceleration.invalidId');
  const name = draft.name.trim();
  if (name === '' || name.length > 100) errors.name = t('admin.acceleration.invalidName');
  errors.controlBaseUrl = urlError(draft.controlBaseUrl, t);
  errors.backendBaseUrl = urlError(draft.backendBaseUrl, t);

  const lease = parseInteger(draft.leaseTtlSeconds);
  if (lease === null || lease <= 0) errors.leaseTtlSeconds = t('admin.acceleration.invalidPositive');
  const rate = parseInteger(draft.uploadRateBytesPerSecond);
  if (rate === null) errors.uploadRateBytesPerSecond = t('admin.acceleration.invalidNonNegative');
  const maxObject = parseInteger(draft.maxObjectBytes);
  if (maxObject === null || maxObject <= 0) errors.maxObjectBytes = t('admin.acceleration.invalidPositive');
  const budget = parseInteger(draft.storageBudgetBytes);
  if (budget === null || budget <= 0) errors.storageBudgetBytes = t('admin.acceleration.invalidPositive');

  const high = parseInteger(draft.storageHighWatermarkPercent);
  const low = parseInteger(draft.storageLowWatermarkPercent);
  if (high === null || high <= 0 || high > 100) errors.storageHighWatermarkPercent = t('admin.acceleration.invalidPercent');
  if (low === null || low <= 0 || low > 100) errors.storageLowWatermarkPercent = t('admin.acceleration.invalidPercent');
  if (high !== null && low !== null && !errors.storageHighWatermarkPercent && !errors.storageLowWatermarkPercent && low >= high) {
    errors.storageLowWatermarkPercent = t('admin.acceleration.invalidWatermarkOrder');
  }

  const horizon = parseInteger(draft.prefetchHorizon);
  if (horizon === null || horizon > MAX_PREFETCH_HORIZON) {
    errors.prefetchHorizon = t('admin.acceleration.invalidPrefetchHorizon', { max: MAX_PREFETCH_HORIZON });
  } else if (draft.cacheMode === 'prefetch' && horizon === 0) {
    // 仅待播模式的需求集合只有队列视界这一个来源，视界为 0 = 资源启用了却什么都不缓存。
    errors.prefetchHorizon = t('admin.acceleration.invalidPrefetchHorizonZero');
  }
  const share = parseInteger(draft.prefetchSharePercent);
  if (share === null || share < 1 || share > 100) {
    errors.prefetchSharePercent = t('admin.acceleration.invalidPercent');
  } else if (draft.cacheMode === 'prefetch_and_heat' && low !== null && !errors.storageLowWatermarkPercent && share > low) {
    // 钉住的待播对象 GC 动不了：份额上限越过低水位，回收目标就永远够不到。
    errors.prefetchSharePercent = t('admin.acceleration.invalidPrefetchShareOverLow', { low });
  }

  const interval = parseInteger(draft.inventoryIntervalSeconds);
  const stale = parseInteger(draft.inventoryStaleAfterSeconds);
  if (interval === null || interval < 60) errors.inventoryIntervalSeconds = t('admin.acceleration.invalidInventoryInterval');
  if (stale === null || stale <= 0) errors.inventoryStaleAfterSeconds = t('admin.acceleration.invalidPositive');
  else if (interval !== null && stale < interval) {
    errors.inventoryStaleAfterSeconds = t('admin.acceleration.invalidInventoryStale');
  }

  for (const key of Object.keys(errors) as Array<keyof AccelerationDraft>) {
    if (errors[key] === undefined) delete errors[key];
  }
  return errors;
}

// ---------- 字段原子 ----------

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
}) {
  const noteId = useId();
  const note = error ?? (hint || undefined);
  return (
    <label className="block text-xs text-muted">
      {label}
      {children(note === undefined ? undefined : noteId, error !== undefined)}
      {note !== undefined && (
        <span
          id={noteId}
          className={`mt-1 block text-[11px] ${error ? 'text-[#D05A4E]' : 'text-faint'}`}
          role={error ? 'alert' : undefined}
        >
          {note}
        </span>
      )}
    </label>
  );
}

function TextField({
  label,
  value,
  error,
  placeholder,
  mono = false,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  placeholder?: string;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} error={error}>
      {(describedBy, invalid) => (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${inputClass} ${mono ? 'font-mono text-xs' : ''} ${invalid ? 'border-[#D05A4E]' : ''}`}
        />
      )}
    </Field>
  );
}

function NumberField({
  label,
  value,
  error,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(describedBy, invalid) => (
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${inputClass} tabular-nums ${invalid ? 'border-[#D05A4E]' : ''}`}
        />
      )}
    </Field>
  );
}

/**
 * 枚举字段。radix Select 的触发器是 button，不能被 <label> 包住（点标签会误触发下拉），
 * 所以沿用 IntegrationMappingPanels 的写法：说明性 span + ariaLabel。
 */
function SelectField({
  label,
  value,
  options,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-muted">{label}</span>
      <Select
        value={value}
        onValueChange={onChange}
        options={options}
        ariaLabel={label}
        className="mt-1.5 w-full"
      />
      {hint !== undefined && hint !== '' && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{title}</legend>
      <div className="grid gap-3">{children}</div>
    </fieldset>
  );
}

/**
 * 表单主体：按「端点 / 上传限额 / 存储容量 / Inventory」分组，
 * 字节与秒都在输入框下方实时回显人类可读值（原来只能盲填 891289600）。
 */
export function AccelerationFields({
  draft,
  errors,
  withId,
  t,
  onChange,
}: {
  draft: AccelerationDraft;
  errors: DraftErrors;
  withId: boolean;
  t: Translate;
  onChange: (patch: Partial<AccelerationDraft>) => void;
}) {
  const hints = useMemo(
    () => ({
      lease: formatSeconds(t, Number(draft.leaseTtlSeconds)),
      rate: formatRate(t, Number(draft.uploadRateBytesPerSecond)),
      maxObject: sizeHint(t, draft.maxObjectBytes),
      budget: sizeHint(t, draft.storageBudgetBytes),
      interval: formatSeconds(t, Number(draft.inventoryIntervalSeconds)),
      stale: formatSeconds(t, Number(draft.inventoryStaleAfterSeconds)),
    }),
    [draft, t],
  );

  // prefetch 模式下待播可以用满预算，份额不参与计算。字段不禁用——禁用会让上一模式
  // 遗留的非法值既改不动又拦住提交，这里只把「不生效」写在说明里。
  const shareInactive = draft.cacheMode === 'prefetch';

  return (
    <div className="grid gap-5">
      <FieldGroup title={t('admin.acceleration.formIdentity')}>
        {withId && (
          <TextField
            label={t('admin.acceleration.idLabel')}
            value={draft.id}
            error={errors.id}
            placeholder={t('admin.acceleration.idPlaceholder')}
            mono
            onChange={(value) => onChange({ id: value })}
          />
        )}
        <TextField
          label={t('admin.acceleration.nameLabel')}
          value={draft.name}
          error={errors.name}
          placeholder={t('admin.acceleration.namePlaceholder')}
          onChange={(value) => onChange({ name: value })}
        />
      </FieldGroup>

      <FieldGroup title={t('admin.acceleration.formEndpoints')}>
        <TextField
          label={t('admin.acceleration.controlUrlLabel')}
          value={draft.controlBaseUrl}
          error={errors.controlBaseUrl}
          placeholder={t('admin.acceleration.controlUrlPlaceholder')}
          mono
          onChange={(value) => onChange({ controlBaseUrl: value })}
        />
        <TextField
          label={t('admin.acceleration.backendUrlLabel')}
          value={draft.backendBaseUrl}
          error={errors.backendBaseUrl}
          placeholder={t('admin.acceleration.backendUrlPlaceholder')}
          mono
          onChange={(value) => onChange({ backendBaseUrl: value })}
        />
      </FieldGroup>

      <FieldGroup title={t('admin.acceleration.formLimits')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label={t('admin.acceleration.leaseTtl')}
            value={draft.leaseTtlSeconds}
            error={errors.leaseTtlSeconds}
            hint={hints.lease}
            onChange={(value) => onChange({ leaseTtlSeconds: value })}
          />
          <NumberField
            label={t('admin.acceleration.uploadRate')}
            value={draft.uploadRateBytesPerSecond}
            error={errors.uploadRateBytesPerSecond}
            hint={hints.rate}
            onChange={(value) => onChange({ uploadRateBytesPerSecond: value })}
          />
          <NumberField
            label={t('admin.acceleration.maxObject')}
            value={draft.maxObjectBytes}
            error={errors.maxObjectBytes}
            hint={hints.maxObject}
            onChange={(value) => onChange({ maxObjectBytes: value })}
          />
        </div>
      </FieldGroup>

      <FieldGroup title={t('admin.acceleration.formStorage')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label={t('admin.acceleration.storageBudget')}
            value={draft.storageBudgetBytes}
            error={errors.storageBudgetBytes}
            hint={hints.budget}
            onChange={(value) => onChange({ storageBudgetBytes: value })}
          />
          <NumberField
            label={t('admin.acceleration.storageLow')}
            value={draft.storageLowWatermarkPercent}
            error={errors.storageLowWatermarkPercent}
            onChange={(value) => onChange({ storageLowWatermarkPercent: value })}
          />
          <NumberField
            label={t('admin.acceleration.storageHigh')}
            value={draft.storageHighWatermarkPercent}
            error={errors.storageHighWatermarkPercent}
            onChange={(value) => onChange({ storageHighWatermarkPercent: value })}
          />
        </div>
      </FieldGroup>

      <FieldGroup title={t('admin.acceleration.formCache')}>
        <SelectField
          label={t('admin.acceleration.cacheMode')}
          value={draft.cacheMode}
          options={[
            { value: 'prefetch', label: t('admin.acceleration.cacheModePrefetch') },
            { value: 'prefetch_and_heat', label: t('admin.acceleration.cacheModePrefetchAndHeat') },
          ]}
          hint={
            draft.cacheMode === 'prefetch'
              ? t('admin.acceleration.cacheModePrefetchHint')
              : t('admin.acceleration.cacheModePrefetchAndHeatHint')
          }
          onChange={(value) => onChange({ cacheMode: value as AccelerationCacheMode })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label={t('admin.acceleration.prefetchHorizon')}
            value={draft.prefetchHorizon}
            error={errors.prefetchHorizon}
            hint={t('admin.acceleration.prefetchHorizonHint')}
            onChange={(value) => onChange({ prefetchHorizon: value })}
          />
          <NumberField
            label={t('admin.acceleration.prefetchShare')}
            value={draft.prefetchSharePercent}
            error={errors.prefetchSharePercent}
            hint={
              shareInactive
                ? t('admin.acceleration.prefetchShareInactive')
                : t('admin.acceleration.prefetchShareHint')
            }
            onChange={(value) => onChange({ prefetchSharePercent: value })}
          />
        </div>
      </FieldGroup>

      <FieldGroup title={t('admin.acceleration.formInventory')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label={t('admin.acceleration.inventoryInterval')}
            value={draft.inventoryIntervalSeconds}
            error={errors.inventoryIntervalSeconds}
            hint={hints.interval}
            onChange={(value) => onChange({ inventoryIntervalSeconds: value })}
          />
          <NumberField
            label={t('admin.acceleration.inventoryStale')}
            value={draft.inventoryStaleAfterSeconds}
            error={errors.inventoryStaleAfterSeconds}
            hint={hints.stale}
            onChange={(value) => onChange({ inventoryStaleAfterSeconds: value })}
          />
        </div>
      </FieldGroup>
    </div>
  );
}

function sizeHint(t: Translate, raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return '';
  return t('admin.acceleration.sizeHint', { value: formatBytes(value) });
}

/** 新建 / 编辑共用外壳：只在按钮文案与 id 字段上分叉。 */
export function AccelerationFormDialogBody({
  draft,
  withId,
  submitting,
  submitLabel,
  t,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: AccelerationDraft;
  withId: boolean;
  submitting: boolean;
  submitLabel: string;
  t: Translate;
  onChange: (patch: Partial<AccelerationDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const errors = useMemo(() => validateDraft(draft, t, withId), [draft, t, withId]);
  const invalid = Object.keys(errors).length > 0;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || submitting) return;
        onSubmit();
      }}
      className="grid gap-5"
    >
      <AccelerationFields draft={draft} errors={errors} withId={withId} t={t} onChange={onChange} />
      {withId && <p className="text-xs text-faint">{t('admin.acceleration.createDefaults')}</p>}
      <div className="flex justify-end gap-2 border-t border-hairline pt-4">
        <button type="button" onClick={onCancel} disabled={submitting} className={secondaryButtonClass}>
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={submitting || invalid} className={primaryButtonClass}>
          {submitting ? t('admin.common.working') : submitLabel}
        </button>
      </div>
    </form>
  );
}
