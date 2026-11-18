import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from './components';

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#102A43', light: '#FFFFFF' } });
}
export async function qrPngDataUrl(text: string, size = 1024): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#102A43', light: '#FFFFFF' } });
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function QrCodeView({ text, fileName, size = 220, exportable, overlay }: { text: string; fileName?: string; size?: number; exportable?: boolean; overlay?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    qrSvg(text).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative rounded-2xl bg-white p-2 ring-1 ring-navy/10" style={{ width: size, height: size }}>
        {svg ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="h-full w-full animate-pulse rounded-xl bg-navy/5" />}
        {overlay && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-18deg] rounded-lg bg-fuchsia-600/95 px-3 py-1.5 text-center text-sm font-extrabold uppercase tracking-wide text-white shadow-lg">{overlay}</span>
          </div>
        )}
      </div>
      {exportable && svg && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon="download" onClick={() => download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), `${fileName ?? 'qrcode'}.svg`)}>
            SVG
          </Button>
          <Button size="sm" variant="secondary" icon="download" onClick={async () => download(await qrPngDataUrl(text), `${fileName ?? 'qrcode'}.png`)}>
            PNG
          </Button>
        </div>
      )}
    </div>
  );
}
