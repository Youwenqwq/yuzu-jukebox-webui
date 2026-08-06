/**
 * 桌面播放器外壳：左侧曲库、顶栏、主内容区、底部播放栏、队列抽屉。
 * 壳状态（房间动作/播放授权/播放接线）抽到 shell/state.ts，与移动壳共用；
 * 房间从「页面」降级为「状态」——播放接线常驻，页面切换不影响出声。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Search as SearchIcon } from 'lucide-react';
import type { PlaylistInfo } from '../api/types';
import { api } from '../app/session';
import { useConnStatus, useIdentity } from './hooks';
import { AccountMenu } from './AccountMenu';
import { LibraryList } from './LibraryList';
import ThemeControls from './ThemeControls';
import { PlayerBar } from './shell/PlayerBar';
import { QueueDrawer } from './shell/QueueDrawer';
import { SEARCH_PROVIDER_KEY, ShellContext } from './shellContext';
import { useShellState } from './shell/state';

export { useShell } from './shellContext';
export { SEARCH_PROVIDER_KEY } from './shellContext';
export type { JoinResult } from './shellContext';

export default function AppShell() {
  const { t } = useTranslation();
  const value = useShellState();
  const status = useConnStatus();

  return (
    <ShellContext.Provider value={value}>
      <div className="flex h-dvh flex-col">
        {(status === 'reconnecting' || status === 'offline') && (
          <div className="bg-accent-soft py-1.5 text-center text-sm text-accent">
            {t(status === 'offline' ? 'conn.offline' : 'conn.reconnecting')}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        </div>

        <PlayerBar />
        <QueueDrawer />
      </div>
    </ShellContext.Provider>
  );
}

/** 顶栏：provider 下拉 + 搜索框（意图入口）+ 管理/主题 + 账户菜单。窄屏时兼作导航条。 */
function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState(
    () => localStorage.getItem(SEARCH_PROVIDER_KEY) ?? 'ncm',
  );

  // provider 列表就绪后校正记忆值：非法值回退 ncm → 首个可用
  useEffect(() => {
    api
      .listProviders()
      .then((list) => {
        const ids = list.map((item) => item.id);
        setProviders(ids);
        setProvider((current) => {
          if (ids.includes(current)) return current;
          const next = ids.includes('ncm') ? 'ncm' : (ids[0] ?? current);
          localStorage.setItem(SEARCH_PROVIDER_KEY, next);
          return next;
        });
      })
      .catch(() => {});
  }, []);

  const goSearch = (q: string, p: string) => {
    if (q) navigate(`/search?q=${encodeURIComponent(q)}&p=${encodeURIComponent(p)}`);
  };

  const changeProvider = (id: string) => {
    setProvider(id);
    localStorage.setItem(SEARCH_PROVIDER_KEY, id);
    // 已在搜索页且有查询词：立即用新 provider 重搜
    if (location.pathname === '/search') goSearch(params.get('q')?.trim() ?? '', id);
  };

  return (
    <header className="flex flex-none items-center gap-3 border-b border-hairline px-5 py-2.5">
      {/* 窄屏：品牌 + 导航（侧栏隐藏时的替代形态） */}
      <span className="flex-none font-display text-base font-semibold md:hidden">
        Yuzu <em className="font-normal italic text-accent">Jukebox</em>
      </span>
      <nav className="flex flex-none gap-3 text-[13px] md:hidden">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'text-accent' : 'text-muted')}>
          {t('shell.navHome')}
        </NavLink>
      </nav>

      <form
        className="flex w-full max-w-md items-center rounded-full border border-hairline bg-panel focus-within:border-accent"
        onSubmit={(event) => {
          event.preventDefault();
          goSearch(keyword.trim(), provider);
        }}
      >
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              title={t('searchPage.providerPick')}
              className="flex flex-none items-center gap-1 rounded-l-full py-1.5 pr-2 pl-3.5 font-mono text-[12px] text-muted hover:text-paper"
            >
              {provider}
              <ChevronDown className="h-3 w-3 text-faint" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={8}
              className="menu-content z-50 min-w-28 rounded-lg border border-hairline bg-panel-2 p-1.5"
            >
              {providers.map((id) => (
                <DropdownMenu.Item
                  key={id}
                  onSelect={() => changeProvider(id)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 font-mono text-[12.5px] text-muted outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-paper"
                >
                  {id}
                  {id === provider && <Check className="h-3.5 w-3.5 text-accent" />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="h-4 w-px flex-none bg-hairline" />
        <SearchIcon className="pointer-events-none ml-2.5 h-3.5 w-3.5 flex-none text-faint" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('search.placeholder')}
          className="search-input w-full min-w-0 bg-transparent py-1.5 pr-3 pl-2 text-[13px] placeholder:text-faint focus:outline-none"
        />
      </form>

      <div className="flex-1" />
      <AdminEntry />
      <ThemeControls />
      <AccountMenu />
    </header>
  );
}

/** 左侧 Library：品牌（点击回首页）+ 歌单列表（共享 LibraryList）。 */
function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);

  // 挂载 + 路由变化时刷新：在管理页导入/删除歌单后回来即最新
  useEffect(() => {
    let dead = false;
    api
      .listPlaylists()
      .then((list) => {
        if (!dead) setPlaylists(list);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [location.pathname]);

  return (
    <aside className="flex w-60 flex-none flex-col border-r border-hairline max-md:hidden">
      <NavLink to="/" className="px-5 py-5 font-display text-xl font-semibold">
        Yuzu <em className="font-normal italic text-accent">Jukebox</em>
      </NavLink>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-4">
        <div className="px-2 pb-2 font-mono text-[11px] tracking-[0.14em] text-faint">
          {t('shell.library')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LibraryList playlists={playlists} />
        </div>
      </div>
    </aside>
  );
}

function AdminEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const identity = useIdentity();
  const isAdmin = identity?.roles.some((r) => r === 'room_admin' || r === 'media_admin') ?? false;
  if (!isAdmin) return null;
  return (
    <button onClick={() => navigate('/admin')} className="text-left text-[13px] text-muted hover:text-paper">
      {t('admin.entry')}
    </button>
  );
}
