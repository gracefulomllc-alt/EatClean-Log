import { decodeRow, decodeFrame, ean13Check, CODES, PARITY } from "../src/barcode.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const withCheck = (s12) => { let t = 0; for (let i = 0; i < 12; i++) t += +s12[i] * (i % 2 ? 3 : 1); return s12 + ((10 - (t % 10)) % 10); };
const bitsFor = (code) => {
  const par = PARITY[+code[0]]; let b = "101";
  for (let i = 0; i < 6; i++) b += CODES[par[i]][+code[1 + i]];
  b += "01010";
  for (let i = 0; i < 6; i++) b += CODES.R[+code[7 + i]];
  return b + "101";
};
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// Draw a row: quiet zone, bars at `scale` pixels per module, optional blur and noise.
const render = (code, scale, { noise = 0, blur = 0, quiet = 12, light = 220, dark = 35 } = {}) => {
  const bits = bitsFor(code), px = [];
  for (let i = 0; i < quiet * scale; i++) px.push(light);
  for (const b of bits) for (let k = 0; k < scale; k++) px.push(b === "1" ? dark : light);
  for (let i = 0; i < quiet * scale; i++) px.push(light);
  let out = px.slice();
  for (let r = 0; r < blur; r++) out = out.map((v, i) => ((out[i - 1] ?? v) + v + (out[i + 1] ?? v)) / 3);
  return Uint8ClampedArray.from(out.map((v) => v + (rnd() - 0.5) * noise));
};
t(ean13Check("0012345678905") === true || true, "check fn runs");
const codes = ["", "", "", "", "", "", "", ""].map((_, i) => withCheck(String(100000000000 + i * 987654321).slice(0, 12)));
codes.push("0016000275287", "0049000028911", "4006381333931", withCheck("072277601103"));
for (const c of codes) {
  t(ean13Check(c), "valid test code " + c);
  for (const s of [2, 3, 4, 6]) t(decodeRow(render(c, s)) === c, `clean ${c} at ${s}px`);
  t([0, 1, 2, 3, 4, 5].some(() => decodeRow(render(c, 3, { noise: 40, blur: 1 })) === c), `noisy ${c} read within 6 rows`);
  t(decodeRow(Uint8ClampedArray.from(render(c, 3).reverse())) === c, `upside down ${c}`);
}
t(decodeRow(render(codes[0], 3, { noise: 220 })) === null || true, "pure noise does not crash");
const noise = Uint8ClampedArray.from({ length: 400 }, () => rnd() * 255);
t(decodeRow(noise) === null, "random noise reads nothing");
t(decodeRow(new Uint8ClampedArray(400).fill(128)) === null, "blank row reads nothing");
// whole frame: a barcode drawn into RGBA
const row = render("0016000275287", 3), W = row.length, H = 60, data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = row[x]; data[o + 3] = 255; }
t(decodeFrame(data, W, H) === "0016000275287", "decodes a full frame");
console.log(`${ok} ok ${bad} bad`); process.exit(bad ? 1 : 0);
