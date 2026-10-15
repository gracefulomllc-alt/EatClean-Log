import { MEAL_LIBRARY } from "../src/mealLibrary.js";
import { RECIPES } from "../src/mealRecipes.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
for (const m of MEAL_LIBRARY) {
  t(m.recipe && m.recipe.ingredients.length >= 1 && m.recipe.steps.length >= 1, `${m.name} has a recipe`);
  t(!m.recipe || (m.recipe.servings >= 1 && m.recipe.steps.length <= 6), `${m.name} recipe is brief`);
}
const names = new Set(MEAL_LIBRARY.map((m) => m.name));
for (const k of Object.keys(RECIPES)) t(names.has(k), `recipe "${k}" matches a meal`);
console.log(bad ? `${bad} failed` : `recipes ok (${ok})`); process.exit(bad ? 1 : 0);
