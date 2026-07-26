'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Expand, ImageOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';

function downloadName(url: string, contentType: string): string {
  try {
    const segment = new URL(url, window.location.origin).pathname
      .split('/')
      .filter(Boolean)
      .pop();
    if (segment && /\.[a-z0-9]{2,5}$/i.test(segment)) {
      return decodeURIComponent(segment);
    }
  } catch {
    // Fall through to a safe generated name.
  }

  const extension = contentType.split('/')[1]?.split(';')[0] || 'jpg';
  return `whatsapp-image.${extension === 'jpeg' ? 'jpg' : extension}`;
}

export function MessageImage({ url, alt }: { url: string; alt: string }) {
  const t = useTranslations('Inbox.bubble');
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadImage = useCallback(async () => {
    setError(false);
    setLoading(true);

    if (url.startsWith('/api/whatsapp/media/')) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to load media');
        setSrc(URL.createObjectURL(await response.blob()));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
      return;
    }

    setSrc(url);
    setLoading(false);
  }, [url]);

  useEffect(() => {
    void loadImage();
  }, [loadImage]);

  useEffect(() => {
    return () => {
      if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
    };
  }, [src]);

  const handleDownload = useCallback(async () => {
    if (!src || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = downloadName(url, blob.type);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error(t('downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }, [downloading, src, t, url]);

  if (error) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <ImageOff className="text-muted-foreground h-8 w-8" />
      </div>
    );
  }

  if (loading || !src) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <Loader2 className="text-primary h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group ring-offset-background focus-visible:ring-primary relative block overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        aria-label={t('openImage')}
      >
        {/* Dynamic authenticated blob URLs cannot use next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          onError={() => setError(true)}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25 group-focus-visible:bg-black/25">
          <Expand className="h-5 w-5 scale-75 text-white opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden border-white/10 bg-black/95 p-0 text-white sm:max-w-6xl">
          <DialogTitle className="sr-only">{t('imagePreview')}</DialogTitle>
          <div className="absolute top-3 left-3 z-10 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium tracking-wide text-white/70 backdrop-blur-md">
            {t('imagePreview')}
          </div>
          <div className="absolute right-4 bottom-4 z-10">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="bg-white text-black hover:bg-white/90"
            >
              {downloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t('downloadImage')}
            </Button>
          </div>
          <div className="flex h-full min-h-0 items-center justify-center p-4 sm:p-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
