import { MEAL_LIBRARY, suggestMeals, mealOk, avoidNote, ALLERGENS, DIETS } from "../src/mealLibrary.js";
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log("FAIL", m); } };
const txt = (m) => `${m.name} ${m.tags} ${m.blurb} ${m.recipe ? m.recipe.ingredients.join(" ") : ""}`;
for (const k of Object.keys(ALLERGENS)) {
  const left = MEAL_LIBRARY.filter((m) => mealOk(m, { allergies: [k] }));
  t(left.every((m) => !ALLERGENS[k].re.test(txt(m))), `${k}: nothing with it survives`);
  t(left.length >= 20, `${k}: still plenty of meals (${left.length})`);
}
const dairy = suggestMeals("chicken", "Dinner", Infinity, 0, 50, { allergies: ["dairy"] });
t(dairy.length >= 3 && dairy.every((m) => !/cheese|yogurt|ranch|quesadilla/i.test(txt(m))), "chicken dinner without dairy");
const veg = { diet: "vegetarian" };
for (const slot of ["Breakfast", "Lunch", "Dinner", "Snack"]) t(suggestMeals("", slot, Infinity, 0, 50, veg).length >= 4, `vegetarian ${slot} has ideas`);
t(suggestMeals("", null, Infinity, 0, 99, veg).every((m) => !/chicken|beef|turkey|pork|bacon|salmon|shrimp|tuna/i.test(m.name)), "vegetarian: no meat in names");
t(suggestMeals("", "Dinner", Infinity, 0, 99, { diet: "lowcarb" }).every((m) => m.carbs <= 35), "low carb cap");
t(!mealOk({ name: "Pork chop", tags: "", blurb: "", carbs: 1, protein: 1 }, { diet: "halal" }), "halal blocks pork");
t(mealOk({ name: "Chicken sausage and peppers", tags: "", blurb: "", carbs: 1 }, { diet: "halal" }), "halal allows chicken sausage");
t(!mealOk({ name: "Kiwi bowl", tags: "", blurb: "", carbs: 1 }, { allergyOther: "kiwi" }), "other allergy blocks");
t(!mealOk({ name: "Mushroom omelet", tags: "", blurb: "", carbs: 1 }, { dislikes: "mushrooms" }), "dislikes block plurals");
t(MEAL_LIBRARY.every((m) => mealOk(m, null) && mealOk(m, {})), "no rules: everything passes");
const n = avoidNote({ allergies: ["peanuts"], allergyOther: "kiwi", diet: "halal", dislikes: "liver" });
t(/Peanuts/.test(n) && /kiwi/.test(n) && /Halal/.test(n) && /liver/.test(n), "note lists everything");
t(avoidNote({}) === "" && avoidNote(null) === "", "empty note");
console.log(ok, "ok", bad, "bad");
