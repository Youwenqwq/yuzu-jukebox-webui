import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { oidcFlow, session } from './app/session';
import { initTheme } from './app/theme';
import { YuzuError } from './protocol/types';
import LoginView from './ui/LoginView';
import LobbyView from './ui/LobbyView';
import RoomView from './ui/RoomView';
import AdminView from './ui/AdminView';

initTheme();

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
  if (phase === 'login') return <LoginView oidcError={oidcError} onDone={() => setPhase('ready')} />;

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LobbyView />} />
        <Route path="/room/:roomId" element={<RoomView />} />
        <Route path="/admin" element={<AdminView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
