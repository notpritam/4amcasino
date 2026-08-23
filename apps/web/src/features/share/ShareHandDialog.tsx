import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../shared/ui/index.tsx';
import { drawHandCard, type ShareData } from './shareCard.ts';

/** Preview + export of the auto-generated hand result image. */
export function ShareHandDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: ShareData | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    setNote(null);
    void document.fonts.ready.then(() => {
      if (ref.current) drawHandCard(ref.current, data);
    });
  }, [open, data]);

  const toBlob = () =>
    new Promise<Blob>((res, rej) =>
      ref.current!.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'),
    );

  async function download() {
    const b = await toBlob();
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = '4am-hand.png';
    a.click();
    URL.revokeObjectURL(url);
    setNote('Saved as 4am-hand.png');
  }

  async function share() {
    try {
      const b = await toBlob();
      const file = new File([b], '4am-hand.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '4AM Casino hand' });
        setNote('Shared.');
        return;
      }
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
        setNote('Image copied to the clipboard.');
        return;
      }
      await download();
    } catch {
      // user closed the native share sheet; nothing to do
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Share this hand">
      <div className="space-y-3">
        <canvas ref={ref} className="w-full rounded-xl ring-1 ring-slate-200 dark:ring-slate-700" />
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void share()}>
            Share
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => void download()}>
            Download PNG
          </Button>
        </div>
        {note && <p className="text-center text-sm text-emerald-600">{note}</p>}
      </div>
    </Dialog>
  );
}
