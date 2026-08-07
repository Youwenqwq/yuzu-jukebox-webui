import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { oidcFlow, session } from './app/session';
import { initTheme } from './app/theme';
import { YuzuError } from './protocol/types';
import LoginView from './ui/LoginView';
import AppShell from './ui/AppShell';
import MobileShell from './ui/MobileShell';
import HomeView from './ui/HomeView';
import SearchView from './ui/SearchView';
import PlaylistDetailView from './ui/PlaylistDetailView';
import SourceCollectionView from './ui/SourceCollectionView';
import LibraryView from './ui/LibraryView';
import RoomDeepLink from './ui/RoomDeepLink';
import AdminView from './ui/AdminView';
import { useMediaQuery } from './ui/hooks';
import { ToastProvider } from './ui/toast';

initTheme();

/** 同 URL、视图层分离：断点互斥选择桌面壳 / 移动壳，内核单例在壳之上共享。 */
function ResponsiveShell() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  return isDesktop ? <AppShell /> : <MobileShell />;
}

type Phase = 'boot' | 'login' | 'ready';

/** 启动时识别 OAuth 回调（PKCE redirect_uri = 应用根，code/state 落在 location.search） */
function isOidcCallback(): boolean {
  const params = new URLSearchParams(location.search);
  return params.has('code') || params.has('state') || params.has('error');
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [oidcError, setOidcError] = useState<YuzuError | null>(null);

  useEffect(() => {
    const cleanUrl = () => history.replaceState(null, '', location.pathname + location.hash);
    if (isOidcCallback()) {
      oidcFlow
        .handleCallback(location.href)
        .then(async (tokens) => {
          if (tokens === null) return session.boot();
          await session.loginOidc(tokens.idToken, tokens.accessToken);
          return true;
        })
        .then((ok) => {
          cleanUrl();
          setPhase(ok ? 'ready' : 'login');
        })
        .catch((err: unknown) => {
          cleanUrl();
          setOidcError(err instanceof YuzuError ? err : new YuzuError('unknown', String(err)));
          setPhase('login');
        });
      return;
    }
    void session.boot().then((ok) => setPhase(ok ? 'ready' : 'login'));
  }, []);

  // 登出（identity 变 null）后回到登录页
  useEffect(() => {
    if (phase !== 'ready') return;
    return session.subscribe(() => {
      if (session.getIdentity() === null) setPhase('login');
    });
  }, [phase]);

  if (phase === 'boot') return null;

  return (
    <ToastProvider>
      {phase === 'login' ? (
        <LoginView oidcError={oidcError} onDone={() => setPhase('ready')} />
      ) : (
        <HashRouter>
          <Routes>
            <Route element={<ResponsiveShell />}>
              <Route path="/" element={<HomeView />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/playlist/:playlistId" element={<PlaylistDetailView />} />
              <Route path="/source/:spec" element={<SourceCollectionView />} />
              <Route path="/library" element={<LibraryView />} />
              {/* 旧 /room/:id 链接的兼容入口：同样只承担「切房」动作 */}
              <Route path="/r/:roomId" element={<RoomDeepLink />} />
              <Route path="/room/:roomId" element={<RoomDeepLink />} />
            </Route>
            <Route path="/admin" element={<AdminView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      )}
    </ToastProvider>
  );
}
