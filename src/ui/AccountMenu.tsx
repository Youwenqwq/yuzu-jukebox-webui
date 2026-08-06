import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu } from 'radix-ui';
import { ChevronDown, History, Link as LinkIcon, LogOut, MonitorSpeaker } from 'lucide-react';
import { session } from '../app/session';
import { useIdentity } from './hooks';
import { AccountAvatar } from './AccountAvatar';
import { ThemeContent } from './ThemeControls';
import ExternalBindingDialog from './ExternalBindingDialog';
import { MyHistoryDialog } from './MyHistoryDialog';

/** 账户菜单（桌面/移动共用）。
 * compact（移动端）：触发钮只展示头像，昵称收进菜单顶部；
 * themeInMenu（移动端）：主题控件内嵌菜单（顶栏不放调色盘）。
 */
export function AccountMenu({
  compact = false,
  themeInMenu = false,
  onRoomsClick,
}: {
  compact?: boolean;
  themeInMenu?: boolean;
  onRoomsClick?: () => void;
} = {}) {
  const { t } = useTranslation();
  const identity = useIdentity();
  const [bindingOpen, setBindingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!identity) return null;

  const itemClass =
    'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-paper';

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            title={identity.name}
            className={`flex items-center gap-2 rounded-full py-1 pl-1 hover:bg-[var(--hover)] ${
              compact ? 'pr-1' : 'border border-hairline pr-2.5'
            }`}
          >
            <AccountAvatar identity={identity} />
            {!compact && (
              <>
                <span className="truncate text-[13px] text-muted">{identity.name}</span>
                <ChevronDown className="h-3.5 w-3.5 flex-none text-faint" />
              </>
            )}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="menu-content z-50 w-56 rounded-lg border border-hairline bg-panel-2 p-1.5"
          >
            {compact && (
              <div className="px-2.5 pt-1.5 pb-1">
                <div className="truncate text-[13px] text-paper">{identity.name}</div>
                {identity.kind === 'oidc' && (
                  <div className="truncate text-[11px] text-faint">{identity.id}</div>
                )}
              </div>
            )}
            {onRoomsClick && (
              <DropdownMenu.Item className={itemClass} onSelect={onRoomsClick}>
                <MonitorSpeaker className="h-3.5 w-3.5" />
                {t('shell.roomSwitch')}
              </DropdownMenu.Item>
            )}
            {identity.kind === 'oidc' && (
              <DropdownMenu.Item className={itemClass} onSelect={() => setBindingOpen(true)}>
                <LinkIcon className="h-3.5 w-3.5" />
                {t('lobby.externalBinding')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={itemClass} onSelect={() => setHistoryOpen(true)}>
              <History className="h-3.5 w-3.5" />
              {t('lobby.myHistory')}
            </DropdownMenu.Item>
            {themeInMenu && (
              <div className="border-t border-hairline pt-1">
                <ThemeContent />
              </div>
            )}
            <DropdownMenu.Item
              className={`${itemClass} ${themeInMenu ? 'border-t border-hairline' : ''}`}
              onSelect={() => void session.logout()}
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('lobby.logout')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {identity.kind === 'oidc' && (
        <ExternalBindingDialog open={bindingOpen} onOpenChange={setBindingOpen} />
      )}
      <MyHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
}
