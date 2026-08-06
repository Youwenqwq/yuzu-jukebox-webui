import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Palette, Sun } from 'lucide-react';
import { applyAccent, applyScheme, currentAccent, currentScheme } from '../app/theme';

const PRESETS: Array<[string, string]> = [
  ['柚子黄', '#E3B93C'],
  ['蜜柑', '#E0863C'],
  ['青柚', '#9BBE4A'],
  ['黑胶红', '#D05A4E'],
  ['深夜蓝', '#6A8FD8'],
  ['紫罗兰', '#A67FD4'],
];

/** 主题内容（桌面 Popover 与移动账户菜单共用）：深浅切换 + 预设色 + 自定义色。 */
export function ThemeContent() {
  const { t } = useTranslation();
  const [scheme, setScheme] = useState(currentScheme());
  const [accent, setAccent] = useState(currentAccent());
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const next = scheme === 'dark' ? 'light' : 'dark';
          applyScheme(next);
          setScheme(next);
        }}
        className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[13px] text-muted hover:bg-[var(--hover)] hover:text-paper"
      >
        <span>{t('theme.switchScheme')}</span>
        {scheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>
      <div className="flex items-center gap-2.5 border-t border-hairline px-2.5 py-2.5">
        {PRESETS.map(([name, hex]) => (
          <button
            key={hex}
            type="button"
            title={name}
            onClick={() => {
              applyAccent(hex);
              setAccent(hex);
            }}
            className={`h-6 w-6 rounded-full border-2 ${accent === hex ? 'border-paper' : 'border-transparent'}`}
            style={{ background: hex }}
          />
        ))}
        <label
          title={t('theme.custom')}
          className="ml-auto grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-hairline text-faint hover:text-muted"
        >
          <input
            type="color"
            value={accent}
            onChange={(e) => {
              applyAccent(e.target.value);
              setAccent(e.target.value);
            }}
            className="h-0 w-0 opacity-0"
          />
          <Palette className="h-3.5 w-3.5" />
        </label>
      </div>
    </div>
  );
}

/** 桌面顶栏主题控件：调色盘 icon 按钮 + Popover 弹层（移动端收进账户菜单）。 */
export default function ThemeControls() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-2.5">
      <button
        title={t('theme.accent')}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-[var(--hover)] hover:text-paper"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && (
        <div className="menu-content absolute top-9 right-0 z-50 w-56 rounded-lg border border-hairline bg-panel-2 p-1.5">
          <ThemeContent />
        </div>
      )}
    </div>
  );
}
