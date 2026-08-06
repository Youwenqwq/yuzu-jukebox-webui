/**
 * 播放器外壳：登录后的常驻骨架——左侧导航、主内容区、底部播放栏。
 * 房间从「页面」降级为「状态」：外壳持有当前房间（roomStore 单例），
 * 播放接线（renderer / Media Session / 自动播放解锁）全部在这里常驻，
 * 页面切换不再影响出声。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Link as LinkIcon, LogOut, Search as SearchIcon } from 'lucide-react';
import { httpBase } from '../config';
import {
  api,
  getPersistedRoomId,
  roomCredentials,
  roomStore,
  session,
  setLastRoom,
} from '../app/session';
import { renderer } from '../app/player';
import { syncMediaSession } from '../app/mediasession';
import { YuzuError } from '../protocol/types';
import { useConnStatus, useIdentity, useRoomState } from './hooks';
import ExternalBindingDialog from './ExternalBindingDialog';
import ThemeControls from './ThemeControls';
import { useToast } from './toast';
import { PlayerBar } from './shell/PlayerBar';
import { QueueDrawer } from './shell/QueueDrawer';

export type JoinResult = 'joined' | 'need_credential' | 'failed';

interface ShellValue {
  canControl: boolean;
  /** 电台启停授权（policy.radio_control 推导，spec §4.7）；独立于 canControl */
  canRadio: boolean;
  /** requested_by 身份 ID → 显示名（条目快照优先，听众表次之，回退 ID） */
  nameOf: (id: string, snapshot?: string) => string;
  joinRoom: (roomId: string, password?: string) => Promise<JoinResult>;
  leaveRoom: () => Promise<void>;
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
  roomsOpen: boolean;
  setRoomsOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new YuzuError('internal', 'useShell outside AppShell');
  return value;
}

export default function AppShell() {
  const { t } = useTranslation();
  const state = useRoomState();
  const status = useConnStatus();
  const identity = useIdentity();
  const { showError } = useToast();

  const [canControl, setCanControl] = useState(false);
  const [canRadio, setCanRadio] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);

  const roomId = state.roomId;

  // ---------- 播放接线（自 RoomView 上移，常驻外壳） ----------

  useEffect(() => {
    renderer.render(state.playback);
  }, [state.playback]);

  useEffect(() => {
    syncMediaSession(
      state.playback,
      httpBase,
      canControl
        ? {
            onPlay: () => void roomStore.resume().catch(() => {}),
            onPause: () => void roomStore.pause().catch(() => {}),
            onNextTrack: () => void roomStore.skip().catch(() => {}),
          }
        : {},
    );
  }, [canControl, state.playback]);

  useEffect(() => {
    const id = setInterval(() => renderer.tick(), 1000);
    return () => clearInterval(id);
  }, []);

  // 浏览器自动播放限制：首次手势时补一次 play（判断交给渲染内核）
  useEffect(() => {
    const unlock = () => renderer.resumeAfterGesture();
    document.addEventListener('click', unlock);
    return () => document.removeEventListener('click', unlock);
  }, []);

  // 控制与电台授权由服务端按 Principal / Room grant / policy 推导；
  // 加载中/失败都保持 false，避免先展示服务端会拒绝的入口。
  useEffect(() => {
    if (!roomId) {
      setCanControl(false);
      setCanRadio(false);
      return;
    }
    let cancelled = false;
    setCanControl(false);
    setCanRadio(false);
    api
      .roomCapabilities(roomId)
      .then((capabilities) => {
        if (cancelled) return;
        setCanControl(capabilities.controller);
        setCanRadio(capabilities.radio);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // ---------- 入房 / 离房 ----------

  const joinRoom = useCallback(
    async (targetId: string, password?: string): Promise<JoinResult> => {
      if (roomStore.getState().roomId === targetId) return 'joined';
      const credential = password ?? roomCredentials.get(targetId) ?? undefined;
      try {
        if (roomStore.getState().roomId) await roomStore.leave().catch(() => {});
        await roomStore.join(targetId, credential);
        roomCredentials.set(targetId, credential ?? '');
        setLastRoom({ id: targetId, password: credential });
        return 'joined';
      } catch (err: unknown) {
        const error = err instanceof YuzuError ? err : new YuzuError('unknown', String(err));
        if (error.code === 'forbidden') {
          // 凭据缺失/失效：丢弃记忆值，让调用方弹凭据表单
          roomCredentials.clear(targetId);
          return 'need_credential';
        }
        if (error.code === 'not_found') setLastRoom(null);
        showError(error);
        return 'failed';
      }
    },
    [showError],
  );

  const leaveRoom = useCallback(async () => {
    await roomStore.leave().catch(() => {});
    setLastRoom(null);
  }, []);

  // 自动入房（仅启动时一次）：上次房间 → 唯一房间 → 保持未入房空态
  const autoJoinTried = useRef(false);
  useEffect(() => {
    if (autoJoinTried.current) return;
    autoJoinTried.current = true;
    if (roomStore.getState().roomId) return;
    const last = getPersistedRoomId();
    if (last) {
      void joinRoom(last);
      return;
    }
    void api
      .listRooms()
      .then((rooms) => {
        if (rooms.length === 1 && !roomStore.getState().roomId) void joinRoom(rooms[0].id);
      })
      .catch(() => {});
  }, [joinRoom]);

  // ---------- requester 名字解析 ----------

  const nameOf = useMemo(() => {
    const names = new Map(state.listeners.map((l) => [l.id, l.name]));
    if (identity) names.set(identity.id, identity.name);
    return (id: string, snapshot?: string) => snapshot || names.get(id) || id;
  }, [state.listeners, identity]);

  const value: ShellValue = {
    canControl,
    canRadio,
    nameOf,
    joinRoom,
    leaveRoom,
    queueOpen,
    setQueueOpen,
    roomsOpen,
    setRoomsOpen,
  };

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

/** 搜索 provider 的本机记忆：顶栏下拉写入，搜索页缺省读取。 */
export const SEARCH_PROVIDER_KEY = 'yuzu-search-provider';

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
          className="w-full min-w-0 bg-transparent py-1.5 pr-3 pl-2 text-[13px] placeholder:text-faint focus:outline-none"
        />
      </form>

      <div className="flex-1" />
      <AdminEntry />
      <ThemeControls />
      <AccountMenu />
    </header>
  );
}

/** 账户菜单：昵称 + 首字母头像（Identity 无头像字段），操作收进下拉。 */
function AccountMenu() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const [bindingOpen, setBindingOpen] = useState(false);
  if (!identity) return null;

  const itemClass =
    'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-paper';

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex max-w-40 items-center gap-2 rounded-full border border-hairline py-1 pr-2.5 pl-1 hover:bg-[var(--hover)]"
          >
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent-soft text-xs font-medium text-accent">
              {identity.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-[13px] text-muted">{identity.name}</span>
            <ChevronDown className="h-3.5 w-3.5 flex-none text-faint" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="menu-content z-50 w-44 rounded-lg border border-hairline bg-panel-2 p-1.5"
          >
            {identity.kind === 'oidc' && (
              <DropdownMenu.Item className={itemClass} onSelect={() => setBindingOpen(true)}>
                <LinkIcon className="h-3.5 w-3.5" />
                {t('lobby.externalBinding')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={itemClass} onSelect={() => void session.logout()}>
              <LogOut className="h-3.5 w-3.5" />
              {t('lobby.logout')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {identity.kind === 'oidc' && (
        <ExternalBindingDialog open={bindingOpen} onOpenChange={setBindingOpen} />
      )}
    </>
  );
}

/** 左侧导航：品牌与页面导航；搜索已由顶栏搜索框取代，账户/主题/管理在顶栏。 */
function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="flex w-52 flex-none flex-col border-r border-hairline max-md:hidden">
      <div className="px-5 py-5 font-display text-xl font-semibold">
        Yuzu <em className="font-normal italic text-accent">Jukebox</em>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        <NavItem to="/" end label={t('shell.navHome')} />
      </nav>
    </aside>
  );
}

function NavItem({ to, end, label }: { to: string; end?: boolean; label: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md px-3 py-2 text-[13.5px] transition-colors ${
          isActive ? 'bg-panel-2 text-paper' : 'text-muted hover:bg-panel hover:text-paper'
        }`
      }
    >
      {label}
    </NavLink>
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
