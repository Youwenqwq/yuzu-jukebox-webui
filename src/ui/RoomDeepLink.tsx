/**
 * 房间深链（/r/:roomId，兼容旧 /room/:roomId）：进房后回首页。
 * 房间在外壳架构里是状态而非页面，深链只承担「切换房间」这一动作。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { useShell, type JoinResult } from './AppShell';

export default function RoomDeepLink(): JSX.Element {
  const { t } = useTranslation();
  const { roomId = '' } = useParams();
  const { joinRoom } = useShell();
  const [result, setResult] = useState<JoinResult | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    setResult(null);
    let dead = false;
    void joinRoom(roomId).then((res) => {
      if (!dead) setResult(res);
    });
    return () => {
      dead = true;
    };
  }, [roomId, joinRoom]);

  if (result === 'joined') return <Navigate to="/" replace />;

  return (
    <div className="view-enter mx-auto max-w-sm px-7 pt-24">
      {result === null && <p className="text-center text-muted">{t('shell.deepLinkJoining')}</p>}
      {result === 'failed' && (
        <p className="text-center text-muted">{t('shell.deepLinkFailed')}</p>
      )}
      {result === 'need_credential' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!password) return;
            void joinRoom(roomId, password).then(setResult);
          }}
        >
          <p className="mb-4 text-muted">{t('room.needCredential')}</p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('room.credentialPlaceholder')}
            className="mb-4 w-full rounded-md border border-hairline bg-panel px-4 py-2.5 placeholder:text-faint"
          />
          <button
            type="submit"
            className="w-full rounded-full bg-accent py-2.5 font-medium text-on-accent"
          >
            {t('room.join')}
          </button>
        </form>
      )}
    </div>
  );
}
