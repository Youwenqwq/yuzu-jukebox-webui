import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  isBatteryOptimizationIgnored,
  isNativeApp,
  requestBatteryOptimizationExemption,
} from '../app/nativemedia';

const BATTERY_BANNER_OFF_KEY = 'yuzu-battery-banner-off';

export function BatteryOptBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isNativeApp) return;

    let active = true;
    const refresh = async () => {
      if (localStorage.getItem(BATTERY_BANNER_OFF_KEY) === '1') {
        if (active) setVisible(false);
        return;
      }

      const ignored = await isBatteryOptimizationIgnored();
      if (active) {
        setVisible(
          !ignored && localStorage.getItem(BATTERY_BANNER_OFF_KEY) !== '1',
        );
      }
    };
    const handleFocus = () => {
      void refresh();
    };

    void refresh();
    window.addEventListener('focus', handleFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  if (!isNativeApp || !visible) return null;

  return createPortal(
    <aside
      aria-live="polite"
      className="fixed right-4 bottom-[calc(var(--chrome-b)+4px)] left-4 z-40 flex items-center gap-3 rounded-xl border border-hairline bg-hall px-4 py-3 text-paper [box-shadow:var(--toast-shadow)] md:right-6 md:left-auto md:w-[34rem]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{t('native.batteryTitle')}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {t('native.batteryBody')}
        </p>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <button
          type="button"
          onClick={() => void requestBatteryOptimizationExemption().catch(() => {})}
          className="rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-medium text-on-accent hover:brightness-105"
        >
          {t('native.batteryAction')}
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(BATTERY_BANNER_OFF_KEY, '1');
            setVisible(false);
          }}
          className="rounded-full px-2.5 py-2 text-[12.5px] text-muted hover:bg-[var(--hover)] hover:text-paper"
        >
          {t('native.batteryDismiss')}
        </button>
      </div>
    </aside>,
    document.body,
  );
}
