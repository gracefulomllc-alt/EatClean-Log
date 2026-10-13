// Runs every test from the repo root: `npm test`.
// Most of the app's rules live inside src/App.jsx, so the CJS tests pull the pure functions
// straight out of that file (between section markers) and run them in a sandbox. That keeps
// the tests honest: they exercise the code that ships, not a copy.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const src = readFileSync("src/App.jsx", "utf8");
const dir = mkdtempSync(join(tmpdir(), "cutlog-"));
const between = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error(`markers not found: ${a} .. ${b}`); return src.slice(i, j); };
const fn = (name) => { const i = src.indexOf(`function ${name}(`); const j = src.indexOf("\n}\n", i); if (i < 0 || j < 0) throw new Error("function not found: " + name); return src.slice(i, j + 3); };
const extract = (file, text) => { const p = join(dir, file); writeFileSync(p, text); return p; };

const args = {
  "tier.test.cjs": [extract("tier.js", between("/* ---------- meal tiers", "/* ---------- build a whole meal"))],
  "score.test.cjs": [extract("score.js", between("/* ---------- accountability score", "/* ---------- 30-day challenges"))],
  "fast.test.cjs": [extract("fast.js", between("/* ---------- optional fasting", "/* ---------- lifting log"))],
  "lift.test.cjs": [extract("lift.js", between("/* ---------- lifting log", "/* ---------- accountability score"))],
  "gates.test.cjs": [extract("groups.js", between("/* ---------- groups: what a phone publishes", "/* ---------- groups UI"))],
  "spcview.test.cjs": [extract("spcview.js", fn("spcView"))],
};

let failed = 0;
for (const f of readdirSync("tests").filter((x) => /\.test\.(c?js|mjs)$/.test(x)).sort()) {
  const r = spawnSync("node", [join("tests", f), ...(args[f] || [])], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const bad = r.status !== 0 || /\bFAIL\b/.test(out) || /\b[1-9]\d* bad\b/.test(out);
  if (bad) failed++;
  console.log(`${bad ? "✗" : "✓"} ${f}  ${out.trim().split("\n").slice(-1)[0]}`);
  if (bad) console.log(out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 6).join("\n"));
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
