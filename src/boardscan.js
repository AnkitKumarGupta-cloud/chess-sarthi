// Reads a chess position from a picture of a screen (the teacher's screen share).
// 1. findBoard: finds the 8x8 board (checker pattern), then lines it up on the square edges.
// 2. squares + classify: cuts the 64 squares to 32x32 and runs a small neural network
//    (public/scan/pieces.bin, trained on synthetic squares from many piece sets and board colours).
// 3. readPosition: puts it together, guesses which side is at the bottom.
// Everything runs on the teacher's device. Works on plain {data, width, height} RGBA images, so it can be tested in Node.

export const CLASSES = ["", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];

// ---------- luminance + integral image ----------
function lumaScaled(img, f) {
  const W = img.width, H = img.height, d = img.data;
  const w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f));
  const out = new Float32Array(w * h), cnt = new Float32Array(w * h);
  const sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) {
    const oy = Math.min(h - 1, (y * sy) | 0) * w;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, o = oy + Math.min(w - 1, (x * sx) | 0);
      out[o] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; cnt[o]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1;
  return { L: out, w, h };
}
function integral(L, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  return I;
}
function boxMean(I, w, h, x, y, r) {
  let x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  let x1 = Math.min(w, Math.round(x + r) + 1), y1 = Math.min(h, Math.round(y + r) + 1);
  if (x1 <= x0 || y1 <= y0) return -1;
  const W1 = w + 1;
  return (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
}

// ---------- checker score of one candidate board (x, y, size) ----------
// Each square is sampled near three of its corners (pieces sit in the middle); the samples must agree,
// the two square colours must differ, and the pattern must stop at the board's edge.
const PTS = [[0.18, 0.18], [0.82, 0.18], [0.18, 0.82]];
const vals = new Float32Array(64);
function cellValue(I, w, h, x, y, c, r, i, j, out) {
  const a = boxMean(I, w, h, x + (j + PTS[0][0]) * c, y + (i + PTS[0][1]) * c, r);
  const b = boxMean(I, w, h, x + (j + PTS[1][0]) * c, y + (i + PTS[1][1]) * c, r);
  const d = boxMean(I, w, h, x + (j + PTS[2][0]) * c, y + (i + PTS[2][1]) * c, r);
  const mx = Math.max(a, b, d), mn = Math.min(a, b, d);
  out[0] = a + b + d - mx - mn; out[1] = mx - mn; // median, spread
}
const cv = new Float32Array(2);
function checkerScore(I, w, h, x, y, s, beat) {
  const c = s / 8, r = Math.max(0, Math.floor(c * 0.07));
  let m0 = 0, m1 = 0, spread = 0;
  // quick look at the top two rows first: most candidates fail here
  for (let k = 0; k < 64; k++) {
    const i = k >> 3, j = k & 7;
    cellValue(I, w, h, x, y, c, r, i, j, cv);
    vals[k] = cv[0]; spread += cv[1];
    if ((i + j) & 1) m1 += cv[0]; else m0 += cv[0];
    if (k === 15 && Math.abs(m0 - m1) / 8 < 12) return 0;
  }
  m0 /= 32; m1 /= 32; spread /= 64;
  const diff = Math.abs(m0 - m1);
  if (diff < 12) return 0;
  let d0 = 0, d1 = 0;
  for (let k = 0; k < 64; k++) { if (((k >> 3) + (k & 7)) & 1) d1 += Math.abs(vals[k] - m1); else d0 += Math.abs(vals[k] - m0); }
  d0 /= 32; d1 /= 32;
  let score = diff / (d0 + d1 + spread + 4);
  if (score <= beat) return score;
  let cont = 0, n = 0;
  for (let t = -1; t <= 8; t++) for (const [i, j] of [[-1, t], [8, t], [t, -1], [t, 8]]) {
    if ((t === -1 || t === 8) && (i === t || j === t) && !(i === t && j === t)) { /* corner counted once */ }
    const cx = x + (j + 0.5) * c, cy = y + (i + 0.5) * c;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    cellValue(I, w, h, x, y, c, r, i, j, cv);
    const want = ((i + j) & 1) ? m1 : m0, other = ((i + j) & 1) ? m0 : m1;
    n++; if (Math.abs(cv[0] - want) < Math.abs(cv[0] - other) && Math.abs(cv[0] - want) < diff * 0.25 && cv[1] < diff * 0.4) cont++;
  }
  if (n) score *= 1 - 0.6 * (cont / n);
  return score;
}

function prep(img, maxDim) {
  const f = Math.min(1, maxDim / Math.max(img.width, img.height));
  const { L, w, h } = lumaScaled(img, f);
  return { f, w, h, I: integral(L, w, h) };
}

// ---------- find the board ----------
export function findBoard(img) {
  // 1. coarse search on a small copy of the picture, keeping a few good candidates
  const A = prep(img, 256);
  const cands = [];
  const smin = Math.max(24, Math.round(Math.min(A.w, A.h) * 0.15)), smax = Math.min(A.w, A.h);
  for (let s = smin; s <= smax; s = Math.max(s + 1, Math.round(s * 1.02))) {
    const step = Math.max(1, Math.round(s / 8 / 4));
    for (let y = 0; y + s <= A.h; y += step) for (let x = 0; x + s <= A.w; x += step) {
      const sc = checkerScore(A.I, A.w, A.h, x, y, s, 0);
      if (sc > 0.8) cands.push({ sc, x: x / A.f, y: y / A.f, s: s / A.f });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.sc - a.sc);
  const top = [];
  for (const c of cands) { if (top.every((t) => Math.abs(t.x - c.x) > t.s / 16 || Math.abs(t.y - c.y) > t.s / 16 || Math.abs(t.s - c.s) > t.s / 30)) top.push(c); if (top.length >= 6) break; }
  // 2. polish each on a larger copy
  const B = prep(img, 720);
  let best = { score: 0 };
  for (const t of top) {
    let b = { score: checkerScore(B.I, B.w, B.h, t.x * B.f, t.y * B.f, t.s * B.f, 0), x: t.x * B.f, y: t.y * B.f, s: t.s * B.f };
    for (let pass = 0; pass < 3; pass++) {
      const st = Math.max(1, b.s / 8 / (4 << pass)), ss = b.s * (0.02 / (1 << pass)), b0 = b;
      for (let ds = -2; ds <= 2; ds++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const s = b0.s + ds * ss, x = b0.x + dx * st, y = b0.y + dy * st;
        if (x < 0 || y < 0 || x + s > B.w || y + s > B.h) continue;
        const sc = checkerScore(B.I, B.w, B.h, x, y, s, 0);
        if (sc > b.score) b = { score: sc, x, y, s };
      }
    }
    if (b.score > best.score) best = b;
  }
  if (best.score < 1.2) return null;
  const box = refineEdges(img, { x: best.x / B.f, y: best.y / B.f, size: best.s / B.f });
  return { ...box, score: best.score };
}

// Line the board up on the edges between squares, at full resolution.
function refineEdges(img, box) {
  const c = box.size / 8, m = Math.ceil(c * 0.6);
  const X0 = Math.max(1, Math.floor(box.x - m)), Y0 = Math.max(1, Math.floor(box.y - m));
  const X1 = Math.min(img.width - 2, Math.ceil(box.x + box.size + m)), Y1 = Math.min(img.height - 2, Math.ceil(box.y + box.size + m));
  const d = img.data, W = img.width;
  const lum = (x, y) => { const i = (y * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  const px = new Float32Array(X1 - X0 + 1), py = new Float32Array(Y1 - Y0 + 1);
  const ya = Math.round(box.y + c * 0.5), yb = Math.round(box.y + box.size - c * 0.5);
  const xa = Math.round(box.x + c * 0.5), xb = Math.round(box.x + box.size - c * 0.5);
  const ystep = Math.max(1, Math.floor((yb - ya) / 400)), xstep = Math.max(1, Math.floor((xb - xa) / 400));
  for (let x = X0; x <= X1; x++) { let s = 0; for (let y = Math.max(ya, 0); y <= Math.min(yb, img.height - 1); y += ystep) s += Math.abs(lum(x + 1, y) - lum(x - 1, y)); px[x - X0] = s; }
  for (let y = Y0; y <= Y1; y++) { let s = 0; for (let x = Math.max(xa, 0); x <= Math.min(xb, img.width - 1); x += xstep) s += Math.abs(lum(x, y + 1) - lum(x, y - 1)); py[y - Y0] = s; }
  const at = (p, o, v) => { const k = v - o, i = Math.floor(k), t = k - i; if (i < 0 || i + 1 >= p.length) return 0; return p[i] * (1 - t) + p[i + 1] * t; };
  const fit = (p, o, start) => {
    let best = { v: -1, a: start, c };
    for (let cc = c * 0.97; cc <= c * 1.03; cc += Math.max(0.05, c * 0.002))
      for (let a = start - c * 0.3; a <= start + c * 0.3; a += 0.25) {
        let v = 0; for (let k = 1; k < 8; k++) v += at(p, o, a + k * cc);
        if (v > best.v) best = { v, a, c: cc };
      }
    return best;
  };
  const fx = fit(px, X0, box.x), fy = fit(py, Y0, box.y);
  const cc = (fx.c + fy.c) / 2;
  return { x: fx.a, y: fy.a, size: cc * 8 };
}

// ---------- cut the squares (box filter down to 32x32, RGB 0..1, channels first) ----------
export function squares(img, box) {
  const out = new Float32Array(64 * 3 * 32 * 32), c = box.size / 8, d = img.data, W = img.width, H = img.height;
  const k = Math.max(1, Math.min(4, Math.round(c / 32))); // samples per output pixel per axis
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const base = (i * 8 + j) * 3072, sx = box.x + j * c, sy = box.y + i * c;
    for (let v = 0; v < 32; v++) for (let u = 0; u < 32; u++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let q = 0; q < k; q++) for (let p = 0; p < k; p++) {
        const x = Math.min(W - 1, Math.max(0, Math.floor(sx + ((u + (p + 0.5) / k) / 32) * c)));
        const y = Math.min(H - 1, Math.max(0, Math.floor(sy + ((v + (q + 0.5) / k) / 32) * c)));
        const o = (y * W + x) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
      }
      const o = v * 32 + u;
      out[base + o] = r / n / 255; out[base + 1024 + o] = g / n / 255; out[base + 2048 + o] = b / n / 255;
    }
  }
  return out;
}

// ---------- the network: 3x(conv3x3 + relu + maxpool2), dense 64, dense 13 ----------
export function parseModel(buf) {
  const f = new Float32Array(buf); let o = 0;
  const take = (n) => { const a = f.subarray(o, o + n); o += n; return a; };
  const conv = (ci, co) => ({ ci, co, w: take(co * ci * 9), b: take(co) });
  const m = { c1: conv(3, 16), c2: conv(16, 32), c3: conv(32, 64) };
  m.f1 = { w: take(64 * 1024), b: take(64) }; m.f2 = { w: take(13 * 64), b: take(13) };
  if (o !== f.length) throw new Error("model size mismatch");
  return m;
}
function convReluPool(x, n, L) {
  const { ci, co, w, b } = L, y = new Float32Array(co * (n / 2) * (n / 2)), tmp = new Float32Array(n * n);
  for (let o = 0; o < co; o++) {
    tmp.fill(b[o]);
    for (let c = 0; c < ci; c++) {
      const xo = c * n * n, wo = (o * ci + c) * 9;
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const wv = w[wo + ky * 3 + kx]; if (wv === 0) continue;
        for (let yy = 0; yy < n; yy++) {
          const sy = yy + ky - 1; if (sy < 0 || sy >= n) continue;
          const tro = yy * n, sro = xo + sy * n;
          const xa = kx === 0 ? 1 : 0, xb = kx === 2 ? n - 1 : n;
          for (let xx = xa; xx < xb; xx++) tmp[tro + xx] += wv * x[sro + xx + kx - 1];
        }
      }
    }
    const h = n / 2, yo = o * h * h;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < h; xx++) {
      const a = tmp[2 * yy * n + 2 * xx], bb = tmp[2 * yy * n + 2 * xx + 1], c = tmp[(2 * yy + 1) * n + 2 * xx], dd = tmp[(2 * yy + 1) * n + 2 * xx + 1];
      y[yo + yy * h + xx] = Math.max(0, a, bb, c, dd);
    }
  }
  return y;
}
export function classify(m, sq) {
  const res = [];
  for (let s = 0; s < 64; s++) {
    let x = sq.subarray(s * 3072, (s + 1) * 3072);
    x = convReluPool(x, 32, m.c1); x = convReluPool(x, 16, m.c2); x = convReluPool(x, 8, m.c3);
    const hdn = new Float32Array(64);
    for (let o = 0; o < 64; o++) { let v = m.f1.b[o]; const wo = o * 1024; for (let i = 0; i < 1024; i++) v += m.f1.w[wo + i] * x[i]; hdn[o] = Math.max(0, v); }
    const z = new Float32Array(13); let mx = -1e9;
    for (let o = 0; o < 13; o++) { let v = m.f2.b[o]; for (let i = 0; i < 64; i++) v += m.f2.w[o * 64 + i] * hdn[i]; z[o] = v; if (v > mx) mx = v; }
    let sum = 0; for (let o = 0; o < 13; o++) { z[o] = Math.exp(z[o] - mx); sum += z[o]; }
    let k = 0; for (let o = 0; o < 13; o++) { z[o] /= sum; if (z[o] > z[k]) k = o; }
    res.push({ k, p: z[k], z });
  }
  return res;
}

// ---------- whole position ----------
// Returns the 64 squares as seen on screen (top-left first), a guess whether Black is at the bottom,
// and the board placement in normal (White at the bottom) order.
export function readPosition(img, model) {
  const box = findBoard(img);
  if (!box) return null;
  const cls = fixRules(classify(model, squares(img, box)));
  const screen = cls.map((c) => CLASSES[c.k]);
  // Black at the bottom if the white pieces (kings and pawns count most) sit higher on the screen than the black ones.
  let wr = 0, wn = 0, br = 0, bn = 0;
  screen.forEach((p, i) => {
    if (!p) return; const row = i >> 3, wt = p.toLowerCase() === "k" ? 4 : p.toLowerCase() === "p" ? 2 : 1;
    if (p === p.toUpperCase()) { wr += row * wt; wn += wt; } else { br += row * wt; bn += wt; }
  });
  const flipped = wn && bn ? wr / wn < br / bn : false;
  return { box, screen, conf: cls.map((c) => c.p), flipped };
}

// Use chess rules to fix likely mistakes: no pawns on the first or last row, one king of each colour.
function fixRules(cls) {
  const pick = (c, banned) => { let k = -1; for (let o = 0; o < 13; o++) if (!banned.includes(o) && (k < 0 || c.z[o] > c.z[k])) k = o; c.k = k; c.p = c.z[k]; };
  cls.forEach((c, i) => { const row = i >> 3; if ((row === 0 || row === 7) && (c.k === 1 || c.k === 7)) pick(c, [1, 7]); });
  for (const K of [6, 12]) {
    const has = cls.map((c, i) => [c, i]).filter(([c]) => c.k === K).sort((a, b) => b[0].z[K] - a[0].z[K]);
    has.slice(1).forEach(([c, i]) => pick(c, [K, ...((i >> 3) === 0 || (i >> 3) === 7 ? [1, 7] : [])]));
    if (!has.length) {
      let bi = -1; cls.forEach((c, i) => { if (c.z[K] > 0.15 && (bi < 0 || c.z[K] > cls[bi].z[K])) bi = i; });
      if (bi >= 0) { cls[bi].k = K; cls[bi].p = cls[bi].z[K]; }
    }
  }
  return cls;
}

// Squares as seen on screen -> FEN board part. flipped = Black at the bottom.
export function placement(screen, flipped) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let s = "", e = 0;
    for (let f = 0; f < 8; f++) {
      const i = flipped ? (7 - r) * 8 + (7 - f) : r * 8 + f, p = screen[i];
      if (!p) { e++; continue; }
      if (e) { s += e; e = 0; }
      s += p;
    }
    if (e) s += e;
    rows.push(s);
  }
  return rows.join("/");
}
