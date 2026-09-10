/**
 * MediaViewer：媒体内容渲染器（D-03/D-04/D-07）。
 * 按 MediaTarget.kind 选择对应查看器：
 * - image → <img>（走回环媒体 URL）
 * - video/audio → plyr
 * - pdf → react-pdf（pdfjs worker 本地打包，不依赖外网）
 * - office / other → 诚实的「暂不支持」占位
 * 仅依赖 mediaStore 的 target；URL 经 buildMediaUrl 转到 http://127.0.0.1 回环（ARCHITECTURE §8.10）。
 */
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { buildMediaUrl } from '../../lib/mediaUrl';
import { t } from '../../i18n';
import type { MediaTarget } from './mediaStore';

// pdfjs 5.x：worker 必须与库版本一致（react-pdf 10.5.0 内部固定 5.4.296）
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

function extOf(path: string): string {
  return path.split(/[?#]/)[0]!.split('.').pop()?.toUpperCase() ?? '';
}

function resolveUrl(path: string): string {
  return buildMediaUrl(path) ?? path;
}

function Unsupported({ text }: { text: string }) {
  return <div className="p-6 text-sm text-muted">{text}</div>;
}

function VideoPlayer({ url, title }: { url: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // Plyr 依据元素标签自动判定 video/audio，无需显式 type
    const player = new Plyr(ref.current);
    return () => player.destroy();
  }, [url]);
  return (
    <video ref={ref} controls playsInline className="max-h-full max-w-full">
      <source src={url} />
      {title}
    </video>
  );
}

function AudioPlayer({ url, title }: { url: string; title: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const player = new Plyr(ref.current);
    return () => player.destroy();
  }, [url]);
  return (
    <audio ref={ref} controls>
      <source src={url} />
      {title}
    </audio>
  );
}

function PdfViewer({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="h-full overflow-auto bg-bg p-3">
      <Document
        file={url}
        onLoadSuccess={(d) => setNumPages(d.numPages)}
        onLoadError={(e) => setError(e.message)}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page key={i} pageNumber={i + 1} className="my-2 shadow-sm" />
        ))}
      </Document>
      {error ? (
        <div className="p-3 text-xs text-danger">
          {t('media.loadError')}：{error}
        </div>
      ) : null}
    </div>
  );
}

export function MediaContent({ target }: { target: MediaTarget }) {
  const url = resolveUrl(target.path);
  switch (target.kind) {
    case 'image':
      return (
        <img
          src={url}
          alt={target.title ?? t('media.imageAlt')}
          className="max-h-full max-w-full object-contain"
        />
      );
    case 'video':
      return <VideoPlayer url={url} title={target.title ?? t('media.videoAlt')} />;
    case 'audio':
      return <AudioPlayer url={url} title={target.title ?? t('media.audioAlt')} />;
    case 'pdf':
      return <PdfViewer url={url} />;
    case 'office':
      return <Unsupported text={t('media.officeUnsupported', { ext: extOf(target.path) })} />;
    default:
      return <Unsupported text={t('media.unknownUnsupported')} />;
  }
}
