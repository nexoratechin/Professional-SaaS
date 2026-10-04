import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@college-erp/ui';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function getDetectorCtor(): BarcodeDetectorCtor | undefined {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

/**
 * Camera QR scanner for mobile attendance check-in / ID verification.
 *
 * Uses the native BarcodeDetector API (Chrome/Edge/Android — no third-party dependency, which
 * keeps the PWA bundle small) and degrades to a manual code entry box on browsers without it.
 * The camera stream is always torn down on close/unmount.
 */
export function QrScanner({
  onResult,
  onClose,
  hint,
}: {
  onResult: (value: string) => void;
  onClose: () => void;
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [supported] = useState(() => typeof window !== 'undefined' && Boolean(getDetectorCtor()));

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (value: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stop();
      onResult(value.trim());
    },
    [onResult, stop],
  );

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    const start = async () => {
      const Detector = getDetectorCtor();
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is not available on this device.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        const detector = new Detector({ formats: ['qr_code'] });
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;

        const scan = async () => {
          if (doneRef.current || cancelled) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx && canvas.width > 0) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              try {
                const codes = await detector.detect(canvas);
                const first = codes[0]?.rawValue;
                if (first) {
                  finish(first);
                  return;
                }
              } catch {
                // Transient detect errors are normal between frames; keep scanning.
              }
            }
          }
          rafRef.current = requestAnimationFrame(() => {
            void scan();
          });
        };
        void scan();
      } catch (err) {
        setError(
          err instanceof Error && /permission|denied/i.test(err.message)
            ? 'Camera permission was denied. Enable it in browser settings or enter the code manually.'
            : 'Could not start the camera. Enter the code manually instead.',
        );
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [supported, finish, stop]);

  useEffect(() => stop, [stop]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(15,23,42,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        gap: 12,
      }}
    >
      <div style={{ color: '#fff', textAlign: 'center' }}>
        <strong>Scan QR code</strong>
        {hint && <p style={{ margin: '4px 0 0', color: '#cbd5e1', fontSize: '0.85rem' }}>{hint}</p>}
      </div>

      {supported && !error && (
        <div style={{ position: 'relative', width: 'min(90vw, 360px)', aspectRatio: '1 / 1' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12, background: '#000' }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '18%',
              border: '3px solid rgba(255,255,255,0.85)',
              borderRadius: 12,
              boxShadow: '0 0 0 9999px rgba(15,23,42,0.35)',
            }}
          />
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {error && <p style={{ color: '#fca5a5', maxWidth: 360, textAlign: 'center' }}>{error}</p>}

      {(!supported || error) && (
        <div style={{ width: 'min(90vw, 360px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            label="Enter or paste the code"
            name="manual-code"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="Scanned code"
          />
          <Button onClick={() => manual.trim() && finish(manual)} disabled={!manual.trim()}>
            Submit code
          </Button>
        </div>
      )}

      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}
