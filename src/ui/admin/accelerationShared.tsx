/**
 * AccelerationAdmin 拆分后各子模块共用的样式常量、枚举文案与展示原子。
 *
 * 视觉沿用 admin/ 既有约定（pill 按钮 / hairline 边框 / bg-panel 卡片 / 虚线空态），
 * 不引入新的设计 token，也不改动其他面板。原子只做展示，不含任何数据获取。
 */
import type { ReactNode } from 'react';
import { formatBytes } from '../format';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type CredentialPurpose = 'publisher' | 'delivery' | 'backend';
export const purposeOrder: CredentialPurpose[] = ['publisher', 'delivery', 'backend'];

/** 危险色：与 primitives.tsx 的 ConfirmDialog / 邻近面板保持同一常量。 */
export const dangerTextClass = 'text-[#D05A4E]';

export const inputClass =
  'mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint focus:border-accent';
export const primaryButtonClass =
  'rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
export const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
export const dangerButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';
export const quietButtonClass =
  'rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
export const quietDangerButtonClass =
  'rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';
export const linkButtonClass =
  'text-xs text-muted hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
export const accentLinkButtonClass =
  'text-xs text-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

export function purposeLabel(t: Translate, purpose: CredentialPurpose): string {
  return t(`admin.acceleration.${purpose}Label`);
}

/**
 * 服务端枚举（publisher.state / attempt.phase / inventory_scan.state /
 * request.state）统一走同一张表，缺条目时回退原始值而不是显示空白。
 */
export function stateLabel(t: Translate, value: string): string {
  if (!value) return t('admin.common.none');
  const label = t(`admin.acceleration.states.${value}`);
  return label === `admin.acceleration.states.${value}` ? value : label;
}

/** storage.pressure：unmanaged / normal / high / full。 */
export function pressureLabel(t: Translate, value: string): string {
  if (!value) return t('admin.common.none');
  const label = t(`admin.acceleration.pressureLabels.${value}`);
  return label === `admin.acceleration.pressureLabels.${value}` ? value : label;
}

/** 秒 → 人类可读时长，用于数字输入框下方的实时回显。 */
export function formatSeconds(t: Translate, seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return t('admin.acceleration.durationSeconds', { value: trimNumber(seconds) });
  if (seconds < 3600) return t('admin.acceleration.durationMinutes', { value: trimNumber(seconds / 60) });
  return t('admin.acceleration.durationHours', { value: trimNumber(seconds / 3600) });
}

export function formatRate(t: Translate, bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '';
  return t('admin.acceleration.rateHint', { value: formatBytes(bytesPerSecond) });
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ---------- 展示原子 ----------

/** 状态点：沿用 IntegrationAdmin 的绿点/灰点写法。 */
export function StatusDot({ on }: { on: boolean }) {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-[#71B99A]' : 'bg-faint'}`} />;
}

export function Badge({ tone = 'muted', children }: { tone?: 'muted' | 'accent' | 'warn'; children: ReactNode }) {
  const toneClass =
    tone === 'accent'
      ? 'border-accent-line text-accent'
      : tone === 'warn'
        ? 'border-[#D7A94A]/50 text-[#D7A94A]'
        : 'border-hairline text-muted';
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-normal ${toneClass}`}>
      {children}
    </span>
  );
}

/** 分组小标题；配合 aria-labelledby 把下方内容关联成一个可读区域。 */
export function SectionHeading({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h4 id={id} className="text-xs font-medium uppercase tracking-[0.12em] text-faint">
        {children}
      </h4>
      {action}
    </div>
  );
}

export function MetricTile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border border-hairline bg-panel px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-xs" title={title ?? value}>
        {value}
      </div>
    </div>
  );
}

/**
 * 键值行。值默认可换行且带 title——端点 URL 是这个面板最常被读取的字段，
 * 原来的 truncate + text-right 会把它直接截断且无从查看。
 */
export function InfoRow({
  label,
  value,
  mono = false,
  wrap = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd
        className={`min-w-0 text-right ${mono ? 'font-mono text-xs' : ''} ${wrap ? 'break-all text-left' : 'truncate'}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-hairline px-3 py-4 text-center text-sm text-faint">
      {children}
    </p>
  );
}

export function LoadingHint({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-faint">{children}</p>;
}

/**
 * 失败态：原来所有失败路径都退化成空态（“还没有…”），把错误说成没有数据。
 * 沿用 IntegrationAdmin 的 LoadError 写法：role=alert + 重试入口。
 */
export function LoadError({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-dashed border-hairline bg-panel px-4 py-8 text-center text-sm text-muted"
    >
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 text-accent hover:underline">
        {retryLabel}
      </button>
    </div>
  );
}

/** 服务端回报的错误串：统一成带标签的告警行，而不是裸红字。 */
export function ErrorNote({ label, message }: { label: string; message: string }) {
  return (
    <p className={`mt-2 break-all text-xs ${dangerTextClass}`} role="alert">
      <span className="text-muted">{label}：</span>
      {message}
    </p>
  );
}
