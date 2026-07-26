import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TabPanel, Tabs } from './primitives';

/**
 * 全局管理视图：歌单 / 媒体 / 播放端。
 * 房间内管理（电台/策略/历史）在 RoomView 就地，入口权限由服务端角色兜底。
 */
export default function AdminView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('playlists');

  return (
    <div className="max-w-5xl mx-auto px-7 pb-16">
      <header className="flex items-center gap-4 py-5 border-b border-hairline mb-8">
        <div className="font-display text-xl font-semibold">
          Yuzu <em className="italic font-normal text-accent">Jukebox</em>
        </div>
        <h1 className="text-muted text-sm">{t('admin.title')}</h1>
        <div className="flex-1" />
        <a href="#/" className="text-[13px] text-muted hover:text-paper">
          {t('admin.backToLobby')}
        </a>
      </header>

      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'playlists', label: t('admin.tabPlaylists') },
          { value: 'media', label: t('admin.tabMedia') },
          { value: 'players', label: t('admin.tabPlayers') },
        ]}
      >
        <TabPanel value="playlists">
          <p className="text-faint text-sm">{t('admin.placeholder')}</p>
        </TabPanel>
        <TabPanel value="media">
          <p className="text-faint text-sm">{t('admin.placeholder')}</p>
        </TabPanel>
        <TabPanel value="players">
          <p className="text-faint text-sm">{t('admin.placeholder')}</p>
        </TabPanel>
      </Tabs>
    </div>
  );
}
