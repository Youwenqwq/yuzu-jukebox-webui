/**
 * Radix primitives 的 token 化封装——无障碍（焦点陷阱/键盘导航/ARIA）由 radix 保证，
 * 视觉全部走设计 token（bg-panel-2 / border-hairline / 无阴影 / --radius）。
 */
import { Dialog as DialogPrimitive, Select as SelectPrimitive, Tabs as TabsPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

// ---------- Dialog ----------

export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,380px)] bg-panel-2 border border-hairline rounded-lg p-6">
          <DialogPrimitive.Title className="font-display text-lg font-semibold">
            {props.title}
          </DialogPrimitive.Title>
          {props.description && (
            <DialogPrimitive.Description className="text-sm text-muted mt-2">
              {props.description}
            </DialogPrimitive.Description>
          )}
          <div className="flex justify-end gap-3 mt-6">
            <DialogPrimitive.Close asChild>
              <button className="text-sm text-muted border border-hairline rounded-full px-4 py-1.5 hover:text-paper hover:border-faint">
                {props.cancelText}
              </button>
            </DialogPrimitive.Close>
            <button
              onClick={props.onConfirm}
              className={`text-sm font-medium rounded-full px-4 py-1.5 ${
                props.danger
                  ? 'bg-[#D05A4E] text-white hover:brightness-110'
                  : 'bg-accent text-on-accent hover:brightness-105'
              }`}
            >
              {props.confirmText}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** 通用 Dialog 容器（表单类弹窗用）：标题 + 任意 children + 底部按钮区 */
export function Dialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,440px)] max-h-[85vh] overflow-y-auto bg-panel-2 border border-hairline rounded-lg p-6">
          <DialogPrimitive.Title className="font-display text-lg font-semibold mb-4">
            {props.title}
          </DialogPrimitive.Title>
          {props.children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------- Tabs ----------

export function Tabs(props: {
  tabs: Array<{ value: string; label: string }>;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root value={props.value} onValueChange={props.onValueChange}>
      <TabsPrimitive.List className="flex gap-1 border-b border-hairline mb-6">
        {props.tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="text-[13.5px] px-3.5 py-2 -mb-px border-b-2 border-transparent text-muted hover:text-paper data-[state=active]:text-paper data-[state=active]:border-accent"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {props.children}
    </TabsPrimitive.Root>
  );
}

export function TabPanel(props: { value: string; children: ReactNode }) {
  return <TabsPrimitive.Content value={props.value}>{props.children}</TabsPrimitive.Content>;
}

// ---------- Select ----------

export function Select(props: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={props.value} onValueChange={props.onValueChange}>
      <SelectPrimitive.Trigger
        className={`inline-flex items-center justify-between gap-2 bg-panel-2 border border-hairline rounded-md px-3 py-1.5 text-[13px] hover:border-faint data-[placeholder]:text-faint ${props.className ?? ''}`}
      >
        <SelectPrimitive.Value placeholder={props.placeholder} />
        <SelectPrimitive.Icon className="text-faint text-[10px]">▼</SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="z-50 bg-panel-2 border border-hairline rounded-md overflow-hidden shadow-xl">
          <SelectPrimitive.Viewport>
            {props.options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className="text-[13px] px-3 py-1.5 cursor-pointer outline-none data-[highlighted]:bg-[var(--hover)] data-[state=checked]:text-accent"
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
