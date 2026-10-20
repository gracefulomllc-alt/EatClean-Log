import { STAGE_DETAIL } from "../src/stageDetail.js";
import { readFileSync } from "node:fs";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const src = readFileSync("src/App.jsx", "utf8");
const ats = [...src.slice(src.indexOf("const STAGES = ["), src.indexOf("STAGES.forEach")).matchAll(/\{ at: (\d+),/g)].map((m) => +m[1]);
t(ats.length >= 12, "stages found: " + ats);
t(ats.every((a) => STAGE_DETAIL[a]?.inside?.length > 80 && STAGE_DETAIL[a]?.feel?.length > 10), "every stage has an inside and a feel description");
t(Object.keys(STAGE_DETAIL).length === ats.length, "no orphan descriptions");
console.log(bad ? `${bad} failed` : `stages ok (${ok})`); process.exit(bad ? 1 : 0);
