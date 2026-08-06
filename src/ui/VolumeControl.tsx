import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import { audio } from '../app/player';

/** 音量控制：图标按钮（点击 mute/取消静音）+ 滑杆。图标随静音态切换。 */
export function VolumeControl(props: { className?: string }): JSX.Element {
  const { t } = useTranslation();
  const [volume, setVolume] = useState(audio.volume);
  const [muted, setMuted] = useState(audio.muted);

  return (
    <div className={`flex items-center gap-1.5 ${props.className ?? ''}`}>
      <button
        title={muted ? t('room.unmute') : t('room.mute')}
        onClick={() => {
          audio.muted = !audio.muted;
          setMuted(audio.muted);
        }}
        className="grid h-8.5 w-8.5 place-items-center rounded-md text-muted hover:bg-[var(--hover)] hover:text-paper"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setVolume(v);
          audio.volume = v;
          if (v > 0 && audio.muted) {
            audio.muted = false;
            setMuted(false);
          }
        }}
        title={t('room.volume')}
        className="w-20"
      />
    </div>
  );
}
