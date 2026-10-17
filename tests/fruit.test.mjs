import { FRUITS, fruitMacros, fruitStep, fruitStart } from "../src/fruit.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const g = FRUITS.find((f) => f.n === "Grapes");
const m = fruitMacros(g, 0.5);
t(m.calories === 52 && m.fiber === 0.7 && m.protein === 0.6, "half a cup of grapes = 52 cal, 0.7 g fiber, 0.6 g protein: " + JSON.stringify(m));
t(fruitMacros(FRUITS.find((f) => f.n === "Banana"), 2).calories === 210, "two bananas");
t(fruitMacros(g, 0).calories === 0 && fruitMacros(g, "x").calories === 0, "zero and junk amounts");
t(new Set(FRUITS.map((f) => f.n)).size === FRUITS.length, "unique names");
t(FRUITS.every((f) => f.per.length === 5 && f.per.every((v) => v >= 0) && f.max > fruitStart(f)), "sane data");
// calories roughly agree with macros (4/4/9)
t(FRUITS.every((f) => Math.abs(f.per[1] * 4 + f.per[2] * 4 + f.per[3] * 9 - f.per[0]) / f.per[0] < 0.35), "calories match macros within 35% (fiber/rounding)");
t(fruitStep(g) === 0.25 && fruitStep(FRUITS.find((f) => f.unit === "apple")) === 0.5 && fruitStep(FRUITS.find((f) => f.unit === "date")) === 1, "steps");
console.log(bad ? `${bad} failed` : `fruit ok (${ok})`); process.exit(bad ? 1 : 0);
