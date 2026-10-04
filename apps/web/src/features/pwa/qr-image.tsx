import React, { useEffect, useState } from 'react';

/** Renders `value` as a QR code data URL using the already-vendored `qrcode` package (loaded
 *  lazily so it never bloats the initial bundle). Mirrors the pattern used by the staff student
 *  profile so web and PWA render identical codes. */
export function QrImage({
  value,
  size = 200,
  alt = 'QR code',
  background = '#ffffff',
  style,
}: {
  value: string;
  size?: number;
  alt?: string;
  background?: string;
  style?: React.CSSProperties;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(value, {
          width: size,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0f172a', light: background },
        }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, background]);

  if (failed) {
    // A long URL should never overflow QR capacity at level M, but degrade gracefully just in case.
    return <p style={{ color: '#b91c1c', fontSize: '0.8rem' }}>Could not render QR code.</p>;
  }
  if (!dataUrl) {
    return (
      <div
        aria-label="Loading QR code"
        style={{ width: size, height: size, background: '#e2e8f0', borderRadius: 8, ...style }}
      />
    );
  }
  return (
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size, background, borderRadius: 8, ...style }}
    />
  );
}
