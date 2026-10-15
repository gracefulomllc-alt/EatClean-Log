import { MORE_FOODS, COMMON_NAMES } from "../src/ingredients.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const names = MORE_FOODS.map((f) => f.n);
t(new Set(names).size === names.length, "no duplicate ingredient names");
for (const f of MORE_FOODS) {
  const [c, p, cb, fa] = f.m;
  t(f.m.length === 4 && f.m.every((v) => v >= 0), `${f.n} has four non-negative numbers`);
  // calories should roughly match the macros (4/4/9), allowing for fiber and alcohol
  const est = p * 4 + cb * 4 + fa * 9;
  t(c < 20 || Math.abs(est - c) <= Math.max(45, c * 0.3), `${f.n} calories ${c} vs macros ${Math.round(est)}`);
  t(!f.s || (f.s.g > 0 && f.s.label), `${f.n} serving is valid`);
}
t(["Egg whites", "Onion", "Spinach, raw", "Bell pepper"].every((n) => names.includes(n)), "egg whites, onion, spinach, pepper are in");
t(COMMON_NAMES.every((n) => names.includes(n) || ["Eggs", "Chicken breast, cooked", "White rice, cooked", "Oats, dry", "Greek yogurt, nonfat", "Banana", "Bread", "Avocado"].includes(n)), "common names exist");
console.log(`${ok} ok ${bad} bad`); process.exit(bad ? 1 : 0);
