import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import IntegrationAdmin from './admin/IntegrationAdmin';
import MediaAdmin from './admin/MediaAdmin';
import PlayerAdmin from './admin/PlayerAdmin';
import PlaylistAdmin from './admin/PlaylistAdmin';
import { useIdentity } from './hooks';
import { TabPanel, Tabs } from './primitives';

/**
 * 全局管理视图：歌单 / 媒体 / 外部集成 / 播放端。
 * 房间内管理（电台/策略/历史）在 RoomView 就地；全局入口按当前身份角色收敛。
 */
export default function AdminView() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const [tab, setTab] = useState('playlists');
  const canManageMedia = identity?.roles.includes('media_admin') ?? false;
  const canManageRooms = identity?.roles.includes('room_admin') ?? false;
  const availableTabs = [
    ...(canManageMedia
      ? [
          { value: 'playlists', label: t('admin.tabPlaylists') },
          { value: 'media', label: t('admin.tabMedia') },
        ]
      : []),
    ...(canManageRooms
      ? [
          { value: 'integrations', label: t('admin.tabIntegrations') },
          { value: 'players', label: t('admin.tabPlayers') },
        ]
      : []),
  ];
  const activeTab = availableTabs.some((item) => item.value === tab)
    ? tab
    : (availableTabs[0]?.value ?? '');

  return (
    <div className="view-enter mx-auto max-w-5xl px-7 pb-16">
      <header className="mb-8 flex items-center gap-4 border-b border-hairline py-5">
        <div className="font-display text-xl font-semibold">
          {t('admin.brandPrimary')} <em className="font-normal italic text-accent">{t('admin.brandAccent')}</em>
        </div>
        <h1 className="text-sm text-muted">{t('admin.title')}</h1>
        <div className="flex-1" />
        <a href="#/" className="text-[13px] text-muted hover:text-paper">
          {t('admin.backToLobby')}
        </a>
      </header>

      {availableTabs.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
          {t('admin.noAccess')}
        </p>
      ) : (
        <Tabs value={activeTab} onValueChange={setTab} tabs={availableTabs}>
          {canManageMedia && (
            <TabPanel value="playlists">
              <PlaylistAdmin />
            </TabPanel>
          )}
          {canManageMedia && (
            <TabPanel value="media">
              <MediaAdmin />
            </TabPanel>
          )}
          {canManageRooms && (
            <TabPanel value="integrations">
              <IntegrationAdmin />
            </TabPanel>
          )}
          {canManageRooms && (
            <TabPanel value="players">
              <PlayerAdmin />
            </TabPanel>
          )}
        </Tabs>
      )}
    </div>
  );
}
