import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { session } from './app/session';
import { initTheme } from './app/theme';
import LoginView from './ui/LoginView';
import LobbyView from './ui/LobbyView';
import RoomView from './ui/RoomView';
import AdminView from './ui/AdminView';
import { ToastProvider } from './ui/toast';

initTheme();

type Phase = 'boot' | 'login' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');

  useEffect(() => {
    void session.boot().then((ok) => setPhase(ok ? 'ready' : 'login'));
  }, []);

  if (phase === 'boot') return null;
  if (phase === 'login') return <LoginView onDone={() => setPhase('ready')} />;

  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<LobbyView />} />
          <Route path="/room/:roomId" element={<RoomView />} />
          <Route path="/admin" element={<AdminView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
