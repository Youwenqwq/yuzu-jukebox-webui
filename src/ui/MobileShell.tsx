/**
 * 移动端外壳（<md）：顶栏（品牌 + 搜索 + 主题 + 账户）、内容区、
 * 紧凑播放条、底部 TabBar（首页 / 搜索 / 曲库）。
 * 与桌面壳共用 shell/state.ts 的壳状态与播放接线——内核仍是组合根单例。
 * 管理功能（/admin）按需求不带入移动端。
 */
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { Home, Library, Search } from 'lucide-react';
import { useConnStatus } from './hooks';
import { ShellContext } from './shellContext';
import { useShellState } from './shell/state';
import { AccountMenu } from './AccountMenu';
import { BatteryOptBanner } from './BatteryOptBanner';
import { MobilePlayerBar } from './MobilePlayerBar';
import { MobileRoomDialog } from './MobileRoomDialog';
import { QueueDrawer } from './shell/QueueDrawer';

export default function MobileShell() {
  const { t } = useTranslation();
  const status = useConnStatus();
  const value = useShellState();

  return (
    <ShellContext.Provider value={value}>
      <div className="flex h-dvh flex-col">
        {(status === 'reconnecting' || status === 'offline') && (
          <div className="bg-accent-soft py-1 text-center text-[12.5px] text-accent">
            {t(status === 'offline' ? 'conn.offline' : 'conn.reconnecting')}
          </div>
        )}

        {/* 移动顶栏：品牌 + 账户（搜索在底部 TabBar，主题收进账户菜单，管理不带入移动端） */}
        <header className="flex flex-none items-center gap-2 border-b border-hairline px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
          <span className="flex-none font-display text-[15px] font-semibold">
            Yuzu <em className="font-normal italic text-accent">Jukebox</em>
          </span>
          <div className="flex-1" />
          <AccountMenu compact themeInMenu onRoomsClick={() => value.setRoomsOpen(true)} />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>

        <MobilePlayerBar />
        <QueueDrawer />
        <MobileTabBar />
        <MobileRoomDialog open={value.roomsOpen} onOpenChange={value.setRoomsOpen} />
      </div>
      <BatteryOptBanner />
    </ShellContext.Provider>
  );
}

/** 移动底部 TabBar：首页 / 搜索 / 曲库。 */
function MobileTabBar() {
  const { t } = useTranslation();
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] transition-colors ${
      isActive ? 'text-accent' : 'text-muted'
    }`;

  return (
    <nav className="flex flex-none border-t border-hairline bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      <NavLink to="/" end className={tabClass}>
        <Home className="h-5 w-5" />
        {t('shell.navHome')}
      </NavLink>
      <NavLink to="/search" className={tabClass}>
        <Search className="h-5 w-5" />
        {t('shell.navSearch')}
      </NavLink>
      <NavLink to="/library" className={tabClass}>
        <Library className="h-5 w-5" />
        {t('shell.library')}
      </NavLink>
    </nav>
  );
}
