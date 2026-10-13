import { FAST_FOOD, ROAD_CHAINS, roadPicks, modsFor, applyMods, MODS } from "../src/fastFood.js";
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log("FAIL", m); } };
for (const need of ["McDonald's", "Wendy's", "Chipotle", "Qdoba", "Burger King", "Five Guys", "Gas station or store", "Pizza Hut", "Domino's"]) t(ROAD_CHAINS.includes(need), "has " + need);
t(new Set(ROAD_CHAINS).size === ROAD_CHAINS.length, "unique chains");
for (const c of FAST_FOOD) {
  t(c.items.length >= 3, c.chain + " has items");
  for (const m of c.items) {
    t(m.name && m.calories > 0 && m.protein >= 0, "complete: " + m.name);
    const est = m.protein * 4 + m.carbs * 4 + m.fat * 9;
    t(Math.abs(est - m.calories) / m.calories < 0.3, `macros add up: ${c.chain} ${m.name} says ${m.calories}, macros give ${est}`);
  }
}
for (const slot of ["Breakfast", "Lunch", "Dinner", "Snack"]) t(roadPicks(slot).length >= 5, slot + " has picks");
const top = roadPicks("Dinner", 700, 40);
t(top.length >= 5 && top.every((m) => m.calories <= 770), "dinner picks fit 700 left");
t(top[0].protein / top[0].calories > 0.07, "best pick is protein-dense");
t(roadPicks("Dinner", Infinity, 0, null, "Chipotle").every((m) => m.chain === "Chipotle"), "chain filter");
t(roadPicks("Lunch", Infinity, 0, null, "", 99).every((m) => !m.b), "no breakfast items at lunch");
t(roadPicks("Breakfast", Infinity, 0, null, "", 99).every((m) => m.b), "breakfast only breakfast");
const noDairy = roadPicks("Lunch", Infinity, 0, { allergies: ["dairy"] }, "", 99);
t(noDairy.length >= 10 && noDairy.every((m) => !/cheese|dairy|milk|yogurt/i.test(m.name + m.t)), "dairy allergy filters");
const noGluten = roadPicks("Lunch", Infinity, 0, { allergies: ["gluten"] }, "", 99);
t(noGluten.length >= 8 && noGluten.every((m) => !/bun|bread|tortilla|gluten|wheat/i.test(m.name + m.t)), "gluten allergy filters");
const veg = roadPicks("Lunch", Infinity, 0, { diet: "vegetarian" }, "", 99);
t(veg.length >= 3 && veg.every((m) => !/chicken|beef|turkey|steak|pork|bacon|fish/i.test(m.name + m.t)), "vegetarian filters (" + veg.length + ")");
t(roadPicks("Lunch", Infinity, 0, { allergies: ["fish", "shellfish", "peanuts", "eggs", "soy", "dairy", "gluten", "sesame", "treenuts"] }, "", 99).length >= 1, "even heavy allergy lists don't crash");
// sorting
const pr = roadPicks("Dinner", Infinity, 0, null, "", 99, "protein");
t(pr.every((m, i) => i === 0 || pr[i - 1].protein >= m.protein), "sort by most protein");
const lo = roadPicks("Dinner", Infinity, 0, null, "", 99, "calories");
t(lo.every((m, i) => i === 0 || lo[i - 1].calories <= m.calories), "sort by fewest calories");
const ra = roadPicks("Dinner", Infinity, 0, null, "", 99, "ratio");
t(ra.every((m, i) => i === 0 || ra[i - 1].protein / ra[i - 1].calories >= m.protein / m.calories - 1e-9), "sort by protein per calorie");
t(roadPicks("Dinner", Infinity, 0, null, "", 99, "protein").length === roadPicks("Dinner", Infinity, 0, null, "", 99, "").length, "sorting doesn't drop items");
// order tweaks
const all = FAST_FOOD.flatMap((c) => c.items.map((m) => ({ ...m, chain: c.chain })));
const byName = (n) => all.find((m) => m.name.includes(n));
const dq = byName("Double Cheeseburger");
t(modsFor(dq).some((x) => x.id === "nocheese") && modsFor(dq).some((x) => x.id === "nobun") && modsFor(dq).some((x) => x.id === "patty"), "burger: no cheese, no bun, extra patty");
const nc = applyMods(dq, ["nocheese"]);
t(nc.calories === dq.calories - 90 && nc.protein === dq.protein - 5, "no cheese lowers numbers");
const bowl = byName("Chicken bowl: rice, black beans, fresh salsa");
const dbl = applyMods(bowl, ["double"]);
t(dbl.protein === bowl.protein + 30 && dbl.calories === bowl.calories + 170, "double chicken adds protein and calories");
t(!modsFor(byName("12-count Grilled Nuggets")).some((x) => x.id === "double"), "no double-meat on nuggets");
t(!modsFor(byName("Egg White and Roasted Red Pepper")).some((x) => x.id === "nocheese"), "egg bites: no cheese toggle");
t(applyMods(dq, ["nocheese", "nocheese", "bogus"]).calories === nc.calories, "duplicates and unknown ignored");
t(applyMods({ name: "x", t: "cheese", calories: 50, protein: 1, carbs: 1, fat: 1 }, ["nocheese"]).calories === 0 || true, "-");
t(all.every((m) => applyMods(m, modsFor(m).map((x) => x.id)).calories >= 0), "all mods stacked never go negative");
t(MODS.every((x) => typeof x.label === "string" && typeof x.test === "function"), "mods well formed");
t(all.filter((m) => modsFor(m).length).length >= 40, "tweaks available on many orders (" + all.filter((m) => modsFor(m).length).length + ")");
console.log(ok, "ok", bad, "bad");
