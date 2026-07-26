import { useTranslation } from 'react-i18next';

/** 占位外壳：内核（protocol/player/api）就绪后替换为真实视图。 */
export default function App() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen grid place-items-center">
      <h1 className="font-display text-2xl">{t('app.title')}</h1>
    </div>
  );
}
