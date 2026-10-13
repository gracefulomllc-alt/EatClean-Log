import { MEAL_LIBRARY, suggestMeals } from "../src/mealLibrary.js";
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log("FAIL", m); } };
for (const m of MEAL_LIBRARY) {
  t(m.name && m.slots.length && m.calories > 0 && m.protein >= 0, "complete: " + m.name);
  // calories must roughly agree with the macros (4/4/9), within 25%
  const est = m.protein * 4 + m.carbs * 4 + m.fat * 9;
  t(Math.abs(est - m.calories) / m.calories < 0.25, `macros add up: ${m.name} says ${m.calories}, macros give ${est}`);
  if (m.recipe) t(m.recipe.ingredients.length && m.recipe.steps.length, "recipe complete: " + m.name);
}
t(new Set(MEAL_LIBRARY.map((m) => m.name)).size === MEAL_LIBRARY.length, "unique names");
for (const slot of ["Breakfast", "Lunch", "Dinner", "Snack"]) {
  t(suggestMeals("", slot).length >= 5, `${slot}: blank search still gives ideas`);
  t(suggestMeals("chicken", slot).length >= 1, `${slot}: chicken has results`);
}
const c = suggestMeals("chicken", "Dinner");
t(c.length >= 5 && c.every((m) => /chicken/i.test(m.name + m.tags)), "chicken dinner: only chicken meals");
t(suggestMeals("chicken", "Dinner", 300, 40).every((m) => m.calories <= 345), "respects what's left today");
t(suggestMeals("burgers", "Dinner").some((m) => /burger/i.test(m.name)), "plural burgers");
t(suggestMeals("something mexican", "Lunch").some((m) => /mexican/.test(m.tags)), "multi-word craving");
t(suggestMeals("steak", "Dinner")[0].name.toLowerCase().includes("steak"), "steak ranks steak first");
t(suggestMeals("zzzz", "Dinner").length === 0, "nonsense finds nothing");
t(suggestMeals("CHICKEN", "dinner" === "x" ? "" : "Dinner").length >= 5, "case-insensitive");
console.log(ok, "ok", bad, "bad");
