// Small helpers for meal cards: scale a recipe to a head count, label meals with diet tags,
// and offer one-tap ingredient swaps that update the numbers.
import { ALLERGENS, DIETS } from "./mealLibrary.js";

/* ---------- scale an ingredient line ("1 1/2 cups rice", "6 oz chicken") ---------- */
const FRACS = [[0, ""], [0.25, "1/4"], [1 / 3, "1/3"], [0.5, "1/2"], [2 / 3, "2/3"], [0.75, "3/4"], [1, ""]];
const PLURAL = new Set(["cup", "can", "scoop", "slice", "clove", "stalk", "egg", "carrot", "pepper", "onion", "potato", "tortilla", "lemon", "lime", "tomato", "avocado", "banana", "apple"]);
export function fmtQty(v) {
  if (!(v > 0)) return "0";
  if (v >= 10) return String(Math.round(v));
  let whole = Math.floor(v), frac = v - whole;
  let best = FRACS[0], d = Infinity;
  for (const f of FRACS) { const dd = Math.abs(frac - f[0]); if (dd < d) { d = dd; best = f; } }
  if (best[0] === 1) { whole += 1; best = FRACS[0]; }
  if (!whole && !best[1]) return "1/4";
  return [whole || "", best[1]].filter(Boolean).join(" ");
}
export function scaleIngredient(text, f) {
  const t = String(text || "");
  if (!(f > 0) || f === 1) return t;
  const m = t.match(/^(\s*)(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(\s*)(.*)$/);
  if (!m) return t;
  const q = m[2].trim();
  let n;
  if (/^\d+\s+\d+\/\d+$/.test(q)) { const [w, fr] = q.split(/\s+/); const [a, b] = fr.split("/"); n = +w + +a / +b; }
  else if (/\//.test(q)) { const [a, b] = q.split("/"); n = +a / +b; }
  else n = +q;
  if (!Number.isFinite(n) || n <= 0) return t;
  const v = n * f;
  let rest = m[4];
  const w = rest.match(/^([A-Za-z]+)(.*)$/);
  if (w) {
    const base = w[1].toLowerCase().replace(/s$/, "");
    if (PLURAL.has(base)) rest = (v > 1.001 ? base + "s" : base) + w[2];
  }
  return `${m[1]}${fmtQty(v)}${m[3]}${rest}`;
}

/* ---------- diet tags ---------- */
const textOf = (m) => `${m.name || ""} ${m.tags || ""} ${m.blurb || ""} ${m.t || ""} ${m.recipe ? m.recipe.ingredients.join(" ") : ""}`;
export const TAG_FILTERS = ["High protein", "Low carb", "Light", "Vegetarian", "Quick"];
export function tagsFor(m) {
  const out = [], t = textOf(m);
  if (m.protein >= 30 || (m.calories > 0 && (m.protein * 4) / m.calories >= 0.35)) out.push("High protein");
  if (m.carbs <= 30) out.push("Low carb");
  if (m.calories <= 350) out.push("Light");
  if (!DIETS.vegetarian.bad(t, m)) out.push("Vegetarian");
  if (m.effort === "grab" || m.effort === "simple") out.push("Quick");
  if (!ALLERGENS.dairy.re.test(t)) out.push("No dairy");
  if (!ALLERGENS.gluten.re.test(t)) out.push("No gluten");
  return out;
}

/* ---------- ingredient swaps ---------- */
// d = [calories, protein, carbs, fat] change for one typical portion in these meals.
export const SWAPS = [
  { id: "cauli", re: /\brice\b/i, not: /cauliflower/i, label: "Cauliflower rice instead of rice", short: "cauliflower rice", d: [-180, -2, -40, 0] },
  { id: "zoodle", re: /pasta|noodle|spaghetti/i, not: /zucchini|zoodle/i, label: "Zucchini noodles instead of pasta", short: "zucchini noodles", d: [-190, -6, -38, -1] },
  { id: "lettuce", re: /\bbun\b|tortilla|\bwrap\b|bread|toast|sandwich|burger/i, not: /lettuce|no bun|no bread|bowl\b|unwich/i, label: "Lettuce wrap instead of bread or tortilla", short: "a lettuce wrap", d: [-120, -4, -20, -3] },
  { id: "turkey", re: /ground beef|beef (burger|patty|bowl|taco)|meatball|beef and/i, not: /turkey/i, label: "Lean ground turkey instead of beef", short: "lean ground turkey", d: [-40, 2, 0, -4] },
  { id: "yogurt", re: /mayo|sour cream|ranch/i, not: /yogurt/i, label: "Plain Greek yogurt instead of mayo or sour cream", short: "Greek yogurt in place of mayo or sour cream", d: [-75, 2, 1, -10] },
  { id: "nocheese", re: /cheese|cheddar|mozzarella|feta/i, not: /cottage|no cheese|skip the cheese/i, label: "Skip the cheese", short: "no cheese", d: [-90, -6, -1, -7] },
];
export function swapsFor(m) {
  const t = textOf(m), done = m.swapped || [];
  return SWAPS.filter((s) => s.re.test(t) && !s.not.test(t) && !done.includes(s.id));
}
export function applySwaps(m, ids) {
  let out = { ...m, swapped: [] };
  for (const id of ids || []) {
    const s = SWAPS.find((x) => x.id === id);
    if (!s || out.swapped.includes(id)) continue;
    const [c, p, cb, f] = s.d;
    out = { ...out, swapped: [...out.swapped, id], calories: Math.max(0, out.calories + c), protein: Math.max(0, out.protein + p), carbs: Math.max(0, out.carbs + cb), fat: Math.max(0, out.fat + f) };
  }
  if (out.swapped.length) {
    const labels = out.swapped.map((id) => SWAPS.find((x) => x.id === id).short);
    out.name = `${m.name} (with ${labels.join(" and ")})`;
    const note = `Swap: use ${labels.join(" and ")}.`;
    if (m.recipe) out.recipe = { ...m.recipe, ingredients: [note, ...m.recipe.ingredients.filter((i) => !/^Swap:/.test(i))] };
    else out.blurb = `${(m.blurb || "").replace(/ Swap: .*$/, "")} ${note}`.trim();
  }
  return out;
}
