// Reads EAN-13 / UPC-A barcodes from camera frames with no library, so scanning works on iPhones too
// (Safari has no built-in BarcodeDetector). Takes grey pixel rows, finds the bar widths, checks the check digit.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = L.map((s) => [...s].map((c) => (c === "1" ? "0" : "1")).join(""));
export const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
export const CODES = { L, G, R };

const runsOfBits = (bits) => { const out = []; let c = bits[0], n = 0; for (const b of bits) { if (b === c) n++; else { out.push(n); c = b; n = 1; } } out.push(n); return out; };
const PAT = { L: L.map(runsOfBits), G: G.map(runsOfBits), R: R.map(runsOfBits) };

export const ean13Check = (s) => {
  if (!/^\d{13}$/.test(s)) return false;
  let t = 0; for (let i = 0; i < 12; i++) t += +s[i] * (i % 2 ? 3 : 1);
  return (10 - (t % 10)) % 10 === +s[12];
};

// Grey row -> alternating run widths. colors[i] = 1 for a dark bar. Uses a local average so uneven light doesn't matter.
function runsFromRow(row) {
  const n = row.length; if (n < 60) return null;
  let min = 255, max = 0; for (let i = 0; i < n; i++) { const v = row[i]; if (v < min) min = v; if (v > max) max = v; }
  if (max - min < 40) return null;
  const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + row[i];
  const w = Math.max(15, Math.round(n / 6)), d = (max - min) * 0.08;
  const runs = [], colors = []; let cur = -1, len = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w), avg = (pre[b] - pre[a]) / (b - a);
    let dark = cur === -1 ? row[i] < avg : cur === 1;
    if (row[i] < avg - d) dark = true; else if (row[i] > avg + d) dark = false;
    const c = dark ? 1 : 0;
    if (c === cur) len++; else { if (cur !== -1) { runs.push(len); colors.push(cur); } cur = c; len = 1; }
  }
  runs.push(len); colors.push(cur);
  return { runs, colors };
}

function match(w, set) {
  const sum = w[0] + w[1] + w[2] + w[3]; let best = -1, bestCost = 1e9;
  for (let d = 0; d < 10; d++) { const p = set[d]; let cost = 0; for (let k = 0; k < 4; k++) cost += Math.abs((w[k] * 7) / sum - p[k]); if (cost < bestCost) { bestCost = cost; best = d; } }
  return [best, bestCost];
}

function tryAt(runs, i) {
  if (i + 59 > runs.length) return null;
  const m = (runs[i] + runs[i + 1] + runs[i + 2]) / 3;
  if (m < 1.5) return null;
  // 95 modules across, every bar between half a module and four modules wide
  let span = 0; for (let k = i; k < i + 59; k++) { span += runs[k]; if (runs[k] < m * 0.3 || runs[k] > m * 4.6) return null; }
  if (Math.abs(span / 95 - m) > m * 0.3) return null;
  const near = (k, tol) => Math.abs(runs[k] - m) <= m * tol;
  if (!near(i, 0.65) || !near(i + 1, 0.65) || !near(i + 2, 0.65)) return null;
  let p = i + 3, digits = [], parity = "", total = 0;
  for (let k = 0; k < 6; k++) {
    const w = runs.slice(p, p + 4); const [dl, cl] = match(w, PAT.L), [dg, cg] = match(w, PAT.G);
    const useL = cl <= cg, c = useL ? cl : cg;
    if (c > 2.4) return null;
    digits.push(useL ? dl : dg); parity += useL ? "L" : "G"; total += c; p += 4;
  }
  for (let k = 0; k < 5; k++) if (!near(p + k, 0.8)) return null;
  p += 5;
  for (let k = 0; k < 6; k++) {
    const w = runs.slice(p, p + 4); const [dr, cr] = match(w, PAT.R);
    if (cr > 2.4) return null;
    digits.push(dr); total += cr; p += 4;
  }
  if (!near(p, 0.8) || !near(p + 1, 0.8) || !near(p + 2, 0.8)) return null;
  const first = PARITY.indexOf(parity);
  if (first < 0) return null;
  const code = String(first) + digits.join("");
  return ean13Check(code) ? code : null;
}

export function decodeRow(row) {
  const r = runsFromRow(row); if (!r) return null;
  for (const flip of [false, true]) {
    const runs = flip ? r.runs.slice().reverse() : r.runs, colors = flip ? r.colors.slice().reverse() : r.colors;
    for (let i = 0; i + 59 <= runs.length; i++) if (colors[i] === 1) { const c = tryAt(runs, i); if (c) return c; }
  }
  return null;
}

// RGBA frame -> code. Tries about 15 lines through the middle of the picture.
export function decodeFrame(data, width, height) {
  const row = new Uint8ClampedArray(width);
  for (let k = 0; k < 15; k++) {
    const y = Math.floor(height * (0.25 + (0.5 * k) / 14));
    for (let x = 0; x < width; x++) { const o = (y * width + x) * 4; row[x] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8; }
    const c = decodeRow(row); if (c) return c;
  }
  return null;
}
