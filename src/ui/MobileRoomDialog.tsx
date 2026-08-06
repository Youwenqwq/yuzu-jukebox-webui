/**
 * 移动端房间弹层（账户菜单触发）：Dialog 承载房间选择 + controller 控制区。
 * 内容与桌面 RoomSwitcher 共用 RoomPickerContent。
 */
import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './primitives';
import { RoomPickerContent } from './shell/RoomPickerContent';

export function MobileRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('shell.roomSwitch')}>
      <RoomPickerContent onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}
