// A built-in set of cut-friendly meals that shows up instantly while you type. Numbers are
// honest estimates for one serving, oil and sauces counted. [calories, protein, carbs, fat].
// effort: grab = no cooking, simple = under 10 minutes, cook = a real recipe.
const M = (name, slots, tags, [calories, protein, carbs, fat], effort, blurb, recipe) =>
  ({ name, slots, tags, calories, protein, carbs, fat, effort, blurb, ...(recipe ? { recipe } : {}) });
const R = (servings, ingredients, steps) => ({ servings, ingredients, steps });

export const MEAL_LIBRARY = [
  // ---- chicken
  M("Grilled chicken, rice and broccoli", ["Lunch", "Dinner"], "chicken rice broccoli bowl meal prep", [520, 52, 48, 10], "cook", "The classic. 6 oz chicken, 1 cup rice, big pile of broccoli.",
    R(1, ["6 oz chicken breast", "1 cup cooked rice", "2 cups broccoli", "1 tsp olive oil", "salt, pepper, garlic powder"], ["Season the chicken and grill or pan-sear 6 to 7 minutes a side.", "Steam the broccoli 4 minutes.", "Serve over the rice."])),
  M("Chicken burrito bowl", ["Lunch", "Dinner"], "chicken mexican rice beans bowl chipotle", [560, 48, 58, 14], "cook", "Chicken, rice, black beans, salsa, a little cheese.",
    R(1, ["5 oz chicken breast", "3/4 cup rice", "1/2 cup black beans", "salsa", "1 tbsp shredded cheese", "lettuce"], ["Cook and slice the chicken with taco seasoning.", "Build the bowl: rice, beans, chicken, lettuce, salsa, cheese."])),
  M("Chicken fajita skillet", ["Dinner"], "chicken mexican peppers onions fajita low carb", [380, 44, 18, 14], "cook", "Peppers, onions and chicken in one pan. No tortilla needed.",
    R(2, ["12 oz chicken breast strips", "2 bell peppers", "1 onion", "1 tbsp oil", "fajita seasoning", "lime"], ["Sear the chicken in oil 5 minutes.", "Add peppers and onion and cook 6 minutes.", "Season and finish with lime."])),
  M("Lemon garlic chicken thighs with green beans", ["Dinner"], "chicken thigh green beans oven sheet pan", [450, 40, 12, 26], "cook", "Skin-off thighs on a sheet pan. Hard to overcook.",
    R(2, ["4 skinless chicken thighs", "2 cups green beans", "2 tsp olive oil", "lemon", "garlic"], ["Toss everything with oil, garlic and lemon.", "Roast at 425F for 25 minutes."])),
  M("Chicken salad with Greek yogurt", ["Lunch"], "chicken salad yogurt sandwich lettuce wrap", [320, 42, 10, 12], "simple", "Shredded chicken, Greek yogurt, celery, mustard. Wrap it in lettuce.",
    R(1, ["5 oz cooked chicken", "1/4 cup plain Greek yogurt", "celery", "mustard", "lettuce leaves"], ["Mix chicken, yogurt, celery and mustard.", "Spoon into lettuce leaves."])),
  M("Rotisserie chicken plate with salad", ["Lunch", "Dinner"], "chicken rotisserie salad grab easy store", [430, 46, 14, 20], "grab", "Half a breast and a wing, skin off, big salad.", null),
  M("Chicken and veggie stir-fry over rice", ["Dinner"], "chicken stir fry asian rice vegetables soy", [520, 46, 55, 11], "cook", "Fast and fills the plate.",
    R(1, ["5 oz chicken breast", "2 cups mixed stir-fry vegetables", "3/4 cup rice", "1 tsp oil", "2 tbsp low-sodium soy sauce"], ["Sear the chicken, set aside.", "Stir-fry vegetables 4 minutes.", "Add chicken and soy and serve over rice."])),
  M("Chicken wrap, high-protein tortilla", ["Lunch"], "chicken wrap tortilla sandwich", [400, 40, 32, 12], "simple", "Grilled chicken, lettuce, tomato, light ranch.", null),
  M("Buffalo chicken lettuce cups", ["Lunch", "Dinner", "Snack"], "chicken buffalo wings spicy low carb", [280, 38, 6, 11], "simple", "Shredded chicken tossed in buffalo sauce, ranch drizzle.", null),
  M("Chicken sausage and peppers", ["Dinner"], "chicken sausage peppers onions", [360, 30, 22, 17], "simple", "Pre-cooked chicken sausage browned with peppers.", null),
  M("Chicken breast with sweet potato", ["Dinner", "Lunch"], "chicken sweet potato meal prep", [480, 48, 46, 8], "cook", "Plain, filling and easy to prep for the week.", null),
  M("Chicken quesadilla, light", ["Lunch", "Dinner"], "chicken quesadilla mexican cheese tortilla", [480, 44, 36, 18], "simple", "Chicken, a little cheese, one tortilla, salsa.", null),
  M("Chicken noodle soup, loaded", ["Lunch", "Dinner"], "chicken soup noodle comfort", [340, 34, 30, 7], "simple", "Extra chicken, extra veg, light on noodles.", null),
  M("Chicken sausage and egg scramble", ["Breakfast"], "chicken sausage eggs egg scramble", [360, 32, 8, 22], "simple", "Pre-cooked chicken sausage, two eggs, spinach.", null),
  M("Chicken and egg breakfast burrito", ["Breakfast"], "chicken eggs burrito tortilla mexican", [440, 38, 34, 16], "simple", "Leftover chicken, scrambled egg, salsa, one tortilla.", null),
  M("Chicken and sweet potato hash with eggs", ["Breakfast"], "chicken sweet potato eggs hash skillet", [470, 40, 38, 16], "cook", "Diced chicken, sweet potato and peppers in one pan, topped with two eggs.", null),
  M("Chicken breast bites with hummus", ["Snack"], "chicken hummus snack bites grab meal prep", [210, 30, 8, 6], "grab", "Cold sliced chicken from the fridge, hummus for dipping.", null),
  // ---- beef and burgers
  M("Lean burger, no bun, side salad", ["Lunch", "Dinner"], "burger beef hamburger low carb", [430, 42, 8, 26], "cook", "93/7 patty, cheese, lettuce wrap, pickles.", null),
  M("Burger on a bun with a side salad", ["Lunch", "Dinner"], "burger beef hamburger bun", [560, 40, 38, 26], "cook", "Single patty, one bun, mustard, side salad instead of fries.", null),
  M("Sirloin steak with roasted potatoes and asparagus", ["Dinner"], "steak beef sirloin potatoes asparagus", [560, 48, 36, 24], "cook", "6 oz sirloin, a small potato, a pile of asparagus.",
    R(1, ["6 oz sirloin", "1 small potato", "8 asparagus spears", "2 tsp olive oil", "salt, pepper"], ["Roast potato at 425F for 25 minutes.", "Sear steak 3 to 4 minutes a side, rest 5 minutes.", "Sear asparagus in the same pan."])),
  M("Beef and broccoli over rice", ["Dinner"], "beef broccoli asian rice stir fry", [540, 40, 54, 16], "cook", "Flank steak, broccoli, light sauce.", null),
  M("Taco bowl with lean ground beef", ["Dinner", "Lunch"], "beef taco mexican bowl ground", [520, 42, 40, 20], "cook", "Lean beef, rice, lettuce, salsa, Greek yogurt for sour cream.", null),
  M("Slow cooker chili", ["Dinner", "Lunch"], "beef chili beans meal prep soup", [420, 36, 36, 14], "cook", "Makes a week of lunches. Lean beef, beans, tomatoes.", null),
  M("Steak salad", ["Lunch", "Dinner"], "steak beef salad greens", [430, 40, 14, 24], "simple", "Sliced steak over greens with balsamic.", null),
  // ---- turkey, pork
  M("Turkey burger with sweet potato fries (baked)", ["Dinner"], "turkey burger sweet potato", [520, 40, 48, 18], "cook", "Ground turkey patty, baked sweet potato wedges.", null),
  M("Ground turkey and rice skillet", ["Dinner", "Lunch"], "turkey ground rice skillet meal prep", [480, 42, 44, 14], "cook", "Turkey, peppers, rice and taco spices in one pan.", null),
  M("Turkey and cheese roll-ups with fruit", ["Lunch", "Snack"], "turkey deli cheese snack", [260, 28, 18, 9], "grab", "Deli turkey around string cheese, an apple on the side.", null),
  M("Pork tenderloin with roasted vegetables", ["Dinner"], "pork tenderloin vegetables", [420, 44, 22, 16], "cook", "Lean cut, easy to slice and meal prep.", null),
  M("Pulled pork lettuce wraps", ["Lunch", "Dinner"], "pork bbq pulled lettuce", [380, 36, 18, 18], "simple", "Lean pulled pork with a little BBQ sauce and slaw.", null),
  // ---- fish and seafood
  M("Baked salmon, quinoa and asparagus", ["Dinner"], "salmon fish quinoa asparagus omega", [540, 42, 34, 26], "cook", "6 oz salmon, 3/4 cup quinoa, asparagus.",
    R(1, ["6 oz salmon fillet", "3/4 cup cooked quinoa", "8 asparagus spears", "1 tsp olive oil", "lemon"], ["Roast salmon and asparagus at 400F for 12 minutes.", "Serve over quinoa with lemon."])),
  M("Shrimp tacos on corn tortillas", ["Dinner", "Lunch"], "shrimp tacos mexican fish seafood", [380, 34, 40, 9], "simple", "Three small tacos, cabbage slaw, lime.", null),
  M("Garlic shrimp with zucchini noodles", ["Dinner"], "shrimp zucchini noodles low carb seafood", [260, 38, 12, 8], "simple", "Very high protein for the calories.", null),
  M("Tuna salad lettuce wraps", ["Lunch", "Snack"], "tuna fish salad lettuce wrap", [260, 36, 6, 9], "simple", "Canned tuna, Greek yogurt, mustard, pickles.", null),
  M("Tuna packet with crackers and fruit", ["Lunch", "Snack"], "tuna fish crackers grab", [280, 28, 30, 5], "grab", "Zero cooking, works in a truck or a job site.", null),
  M("Blackened tilapia with rice and green beans", ["Dinner"], "fish tilapia cod white rice", [420, 40, 40, 8], "cook", "Mild white fish, blackening spice, rice.", null),
  M("Poke bowl", ["Lunch", "Dinner"], "fish tuna salmon rice bowl sushi", [520, 38, 56, 14], "grab", "Tuna or salmon, rice, edamame, cucumber, light sauce.", null),
  // ---- eggs and breakfast
  M("Three-egg veggie scramble with toast", ["Breakfast"], "eggs egg scramble omelet veggies toast", [380, 26, 24, 20], "simple", "Eggs, spinach, peppers, one slice of toast.", null),
  M("Egg white omelet with turkey and spinach", ["Breakfast"], "eggs egg whites omelet turkey spinach", [260, 36, 6, 8], "simple", "Very high protein, light on calories.", null),
  M("Greek yogurt bowl with berries and nuts", ["Breakfast", "Snack"], "yogurt greek berries oats", [310, 28, 32, 8], "grab", "Plain 0% yogurt, a cup of berries, a spoon of almonds.", null),
  M("Overnight oats with protein", ["Breakfast"], "oats oatmeal protein powder prep", [420, 34, 52, 9], "simple", "Oats, milk, whey and chia. Made the night before.", null),
  M("Breakfast burrito, egg and turkey sausage", ["Breakfast"], "eggs burrito sausage tortilla mexican", [450, 32, 36, 20], "simple", "Make four on Sunday and freeze.", null),
  M("Cottage cheese with pineapple", ["Breakfast", "Snack"], "cottage cheese fruit protein", [220, 26, 20, 3], "grab", "A cup of 2% cottage cheese. 25 grams of protein for almost nothing.", null),
  M("Protein shake and a banana", ["Breakfast", "Snack"], "shake whey protein banana smoothie", [300, 30, 36, 3], "grab", "Whey, water or milk, one banana.", null),
  M("Egg and avocado toast", ["Breakfast"], "eggs avocado toast", [380, 18, 30, 21], "simple", "Two eggs, half an avocado, one slice of whole-grain toast.", null),
  M("Hard-boiled eggs and fruit", ["Breakfast", "Snack"], "eggs egg boiled fruit grab", [250, 19, 22, 10], "grab", "Boil a dozen on Sunday.", null),
  // ---- vegetarian and lighter
  M("Black bean and egg breakfast skillet", ["Breakfast", "Lunch"], "vegetarian eggs beans mexican", [400, 26, 38, 15], "simple", "Black beans, two eggs, salsa, a little cheese.", null),
  M("Lentil soup with a side salad", ["Lunch", "Dinner"], "lentil soup vegetarian beans fiber", [360, 22, 54, 6], "cook", "Cheap, filling and high in fiber.", null),
  M("Tofu stir-fry with vegetables and rice", ["Dinner"], "tofu vegetarian stir fry asian rice", [460, 28, 52, 14], "cook", "Extra-firm tofu, vegetables, light soy.", null),
  M("Big salad with chicken, chickpeas and feta", ["Lunch"], "salad chicken chickpeas greens", [460, 40, 28, 20], "simple", "Greens, chicken, chickpeas, cucumber, a little feta, vinaigrette.", null),
  M("Veggie omelet with cheese", ["Breakfast", "Lunch"], "eggs omelet vegetarian cheese veggies", [340, 24, 8, 23], "simple", "Three eggs, spinach, mushrooms, one ounce of cheese.", null),
  M("Edamame and a cheese stick", ["Snack"], "snack edamame vegetarian cheese", [210, 18, 10, 11], "grab", "Frozen edamame, microwave two minutes.", null),
  // ---- carbs and comfort, sized for a cut
  M("Turkey chili mac, lightened", ["Dinner"], "turkey pasta chili comfort", [520, 42, 56, 14], "cook", "Ground turkey, whole-wheat pasta, beans.", null),
  M("Spaghetti with turkey meat sauce", ["Dinner"], "pasta spaghetti turkey italian meat sauce", [560, 42, 66, 12], "cook", "1.5 cups pasta, lean turkey sauce, side salad.", null),
  M("Chicken parmesan, baked, with zucchini", ["Dinner"], "chicken parmesan italian baked", [470, 52, 24, 18], "cook", "Panko-crusted, baked not fried, light cheese.", null),
  M("Pizza night: two slices and a big salad", ["Dinner", "Lunch"], "pizza italian comfort", [620, 32, 66, 24], "grab", "Thin crust, veggie or chicken topping, salad first.", null),
  M("Turkey and avocado sandwich with fruit", ["Lunch"], "turkey sandwich avocado deli", [460, 34, 46, 14], "grab", "Whole-grain bread, lots of lettuce and tomato.", null),
  M("Subway six-inch turkey, double meat", ["Lunch", "Dinner"], "subway sandwich turkey fast food grab", [380, 32, 46, 6], "grab", "Veggies piled on, mustard, no mayo.", null),
  M("Chipotle chicken salad bowl, no rice", ["Lunch", "Dinner"], "chipotle chicken fast food mexican bowl grab", [510, 46, 22, 26], "grab", "Chicken, fajita veggies, salsa, guac or cheese, not both.", null),
  M("Chick-fil-A grilled nuggets and a side salad", ["Lunch", "Dinner"], "chick fil a chicken nuggets fast food grab", [330, 38, 14, 12], "grab", "12-count grilled with a side salad and light dressing.", null),
  // ---- snacks
  M("Apple with peanut butter", ["Snack"], "snack apple peanut butter fruit", [250, 7, 30, 12], "grab", "One tablespoon and a medium apple.", null),
  M("Beef jerky and an orange", ["Snack"], "snack jerky beef grab truck", [180, 14, 22, 3], "grab", "Check the label. The sugar adds up.", null),
  M("Protein bar, 200 calories", ["Snack"], "snack protein bar grab", [200, 20, 20, 7], "grab", "Pick one with 15+ grams of protein and under 8 grams of sugar.", null),
  M("Cottage cheese and cucumber", ["Snack"], "snack cottage cheese vegetables", [140, 18, 8, 3], "grab", "Salt and pepper. Very filling.", null),
  M("Turkey roll-ups", ["Snack"], "snack turkey deli", [120, 18, 2, 4], "grab", "Deli turkey, mustard, a pickle spear.", null),
  M("Greek yogurt with honey", ["Snack"], "snack yogurt greek dessert sweet", [170, 17, 22, 1], "grab", "One cup plain nonfat, one teaspoon honey.", null),
  M("Rice cake with turkey and avocado", ["Snack"], "snack rice cake turkey avocado", [200, 14, 20, 7], "grab", "Crunchy and quick.", null),
  M("Berry protein smoothie", ["Snack", "Breakfast"], "smoothie berries protein shake whey", [240, 28, 26, 3], "grab", "Whey, frozen berries, water, ice.", null),
  M("Dark chocolate and almonds", ["Snack"], "snack chocolate sweet dessert nuts", [200, 5, 14, 15], "grab", "Two squares and eight almonds. Satisfies the sweet tooth.", null),
];

// How a typed word maps to the meals above. Plural, near-miss and casual words all count.
const ALIASES = {
  burgers: "burger", hamburger: "burger", hamburgers: "burger", steaks: "steak", tacos: "taco", wings: "chicken",
  veggie: "vegetarian", veg: "vegetarian", vegan: "vegetarian", seafood: "fish", sushi: "fish", pizza: "pizza",
  mexican: "mexican", italian: "italian", asian: "asian", chinese: "asian", sandwiches: "sandwich", salads: "salad",
  eggs: "egg", oats: "oatmeal", breakfast: "", lunch: "", dinner: "", snack: "", snacks: "",
};
const norm = (w) => { const a = ALIASES[w]; if (a !== undefined) return a; return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w; };

// Pure: score every meal for a typed craving, the meal slot, and what's left today.
// Anything for the slot comes back even with no words typed, so the list is never empty.
export function suggestMeals(query, slot, remainCal = Infinity, remainP = 0, limit = 6) {
  const words = String(query || "").toLowerCase().split(/[^a-z0-9']+/).map(norm).filter((w) => w.length >= 2);
  const pool = MEAL_LIBRARY.filter((m) => !slot || m.slots.includes(slot));
  const scored = pool.map((m) => {
    const hay = `${m.name} ${m.tags} ${m.blurb}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    const inName = words.filter((w) => m.name.toLowerCase().includes(w)).length;
    const fits = Number.isFinite(remainCal) && remainCal > 0 ? (m.calories <= remainCal ? 1 : m.calories <= remainCal * 1.15 ? 0 : -1) : 0;
    const pdens = m.protein / Math.max(1, m.calories) * 100;
    return { m, hits, score: hits * 10 + inName * 4 + fits * 3 + pdens / 4 };
  });
  let matched = words.length ? scored.filter((s) => s.hits > 0) : scored;
  // When there are enough meals that fit what's left today, only show those.
  if (Number.isFinite(remainCal) && remainCal > 0) {
    const fit = matched.filter((s) => s.m.calories <= remainCal * 1.15);
    if (fit.length >= 3) matched = fit;
  }
  return matched.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.m);
}
