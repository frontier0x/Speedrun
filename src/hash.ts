/**
 * Difference hash (dHash) of a raw BGRA bitmap. Downsamples to 9x8 grayscale and records whether
 * each pixel is brighter than its right neighbour, giving a 64-bit fingerprint of the screen.
 */
export function dHash(bgra: Uint8Array, width: number, height: number): bigint {
  const cols = 9;
  const rows = 8;
  const gray = new Float64Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          sum += 0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2];
          n++;
        }
      }
      gray[gy * cols + gx] = n ? sum / n : 0;
    }
  }
  let hash = 0n;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols - 1; gx++) {
      hash = (hash << 1n) | (gray[gy * cols + gx] > gray[gy * cols + gx + 1] ? 1n : 0n);
    }
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export const toHex = (h: bigint) => h.toString(16).padStart(16, '0');
export const fromHex = (s: string) => BigInt('0x' + s);
