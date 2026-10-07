import { desktopCapturer, screen, type Rectangle } from 'electron';
import { dHash } from './hash.js';

export interface Shot {
  jpeg: Buffer;
  hash: bigint;
}

/** Longest side of saved screenshots. ~1280px keeps text readable for the model at ~1.4k image tokens. */
const MAX_SIDE = 1280;

/** Capture the display that holds the active window (or the primary one), downscaled to MAX_SIDE. */
export async function captureScreen(activeBounds?: Rectangle): Promise<Shot | null> {
  const display = activeBounds ? screen.getDisplayMatching(activeBounds) : screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;

  const img = source.thumbnail;
  const size = img.getSize();
  const hash = dHash(img.toBitmap(), size.width, size.height);
  return { jpeg: img.toJPEG(70), hash };
}
