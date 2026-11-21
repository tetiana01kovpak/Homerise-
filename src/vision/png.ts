// Minimal PNG decoder (8-bit gray / gray+alpha / RGB / RGBA / palette,
// non-interlaced) plus an area-averaging downsampler. Pure TS: the caller
// supplies a zlib `inflate` (node:zlib inflateSync in tests,
// DecompressionStream elsewhere).

export interface RGBA { width: number; height: number; data: Uint8ClampedArray }

export function decodePng(bytes: Uint8Array, inflate: (b: Uint8Array) => Uint8Array): RGBA {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8, W = 0, H = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      W = dv.getUint32(pos + 8); H = dv.getUint32(pos + 12);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
  let total = 0;
  for (const c of idat) total += c.length;
  const comp = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { comp.set(c, o); o += c.length; }
  const raw = inflate(comp);
  const stride = W * channels;
  const px = new Uint8Array(H * stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride, prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const r = raw[src + x];
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const c = x >= channels && y > 0 ? px[prev + x - channels] : 0;
      let v: number;
      switch (f) {
        case 0: v = r; break;
        case 1: v = r + a; break;
        case 2: v = r + b; break;
        case 3: v = r + ((a + b) >> 1); break;
        default: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
      }
      px[dst + x] = v & 255;
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const s = i * channels, d = i * 4;
    if (ctype === 0) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255; }
    else if (ctype === 4) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = px[s + 1]; }
    else if (ctype === 2) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255; }
    else if (ctype === 6) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; }
    else {
      const k = px[s];
      out[d] = palette ? palette[k * 3] : k; out[d + 1] = palette ? palette[k * 3 + 1] : k; out[d + 2] = palette ? palette[k * 3 + 2] : k;
      out[d + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width: W, height: H, data: out };
}

/** Area-averaging resample so the long side is at most `maxSide` px (like a canvas downscale). */
export function downsample(img: RGBA, maxSide: number): { image: RGBA; scale: number } {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s >= 1) return { image: img, scale: 1 };
  const W2 = Math.max(1, Math.round(img.width * s)), H2 = Math.max(1, Math.round(img.height * s));
  const sx = img.width / W2, sy = img.height / H2;
  // horizontal pass
  const tmp = new Float32Array(W2 * img.height * 4);
  for (let x = 0; x < W2; x++) {
    const a = x * sx, b = (x + 1) * sx;
    for (let y = 0; y < img.height; y++) {
      let r = 0, g = 0, bl = 0, al = 0;
      for (let u = Math.floor(a); u < Math.ceil(b); u++) {
        const w = Math.min(b, u + 1) - Math.max(a, u);
        const i = (y * img.width + u) * 4;
        r += img.data[i] * w; g += img.data[i + 1] * w; bl += img.data[i + 2] * w; al += img.data[i + 3] * w;
      }
      const j = (y * W2 + x) * 4;
      tmp[j] = r / sx; tmp[j + 1] = g / sx; tmp[j + 2] = bl / sx; tmp[j + 3] = al / sx;
    }
  }
  const out = new Uint8ClampedArray(W2 * H2 * 4);
  for (let y = 0; y < H2; y++) {
    const a = y * sy, b = (y + 1) * sy;
    for (let x = 0; x < W2; x++) {
      let r = 0, g = 0, bl = 0, al = 0;
      for (let v = Math.floor(a); v < Math.ceil(b); v++) {
        const w = Math.min(b, v + 1) - Math.max(a, v);
        const i = (v * W2 + x) * 4;
        r += tmp[i] * w; g += tmp[i + 1] * w; bl += tmp[i + 2] * w; al += tmp[i + 3] * w;
      }
      const j = (y * W2 + x) * 4;
      out[j] = r / sy; out[j + 1] = g / sy; out[j + 2] = bl / sy; out[j + 3] = al / sy;
    }
  }
  return { image: { width: W2, height: H2, data: out }, scale: W2 / img.width };
}
