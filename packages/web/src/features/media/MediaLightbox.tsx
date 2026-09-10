/**
 * MediaLightbox：媒体查看器的统一外壳（D-03/D-04/D-07）。
 * 读取 useMediaStore.target；为 null 时不渲染。点击遮罩/关闭按钮关掉。
 * Office/未知类型由 MediaContent 内部诚实降级为「暂不支持」。
 */
import { Dialog, DialogContent } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { t } from '../../i18n';
import { useMediaStore } from './mediaStore';
import { MediaContent } from './MediaViewer';

export function MediaLightbox() {
  const target = useMediaStore((s) => s.target);
  const close = useMediaStore((s) => s.close);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent title={t('media.title')} className="w-[min(820px,96vw)]">
        <div className="flex h-[70vh] flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
            {target ? <MediaContent target={target} /> : null}
          </div>
          <div className="flex justify-end border-t border-line pt-3">
            <Button variant="ghost" onClick={close}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
