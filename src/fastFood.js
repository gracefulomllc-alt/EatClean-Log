import { mealOk } from "./mealLibrary.js";
// Built-in drive-thru and grab-and-go picks. Numbers are estimates from each chain's published
// nutrition, rounded, for the order exactly as written. Menus change, so the app calls them estimates.
// [calories, protein, carbs, fat]. t = ingredients that aren't in the name (so allergy and diet filters see them).
// b: breakfast item. tweak: one small change that helps.
const I = (name, [calories, protein, carbs, fat], t = "", tweak = "", b = false) => ({ name, calories, protein, carbs, fat, t, tweak, b });

export const FAST_FOOD = [
  { chain: "McDonald's", items: [
    I("Egg McMuffin", [310, 17, 30, 13], "egg canadian bacon ham cheese english muffin bun wheat dairy", "Great breakfast. Skip the hash brown or have just one.", true),
    I("Sausage McMuffin with Egg", [480, 21, 31, 31], "egg pork sausage cheese english muffin bun wheat dairy", "Drop the cheese to save about 50.", true),
    I("McChicken", [400, 14, 39, 21], "chicken bun wheat mayo egg", "Hold the mayo to save about 90."),
    I("Double Cheeseburger", [450, 25, 34, 22], "beef cheese bun wheat dairy", "Hold the cheese for about 50 less."),
    I("Quarter Pounder with Cheese", [520, 30, 42, 26], "beef cheese bun wheat dairy", "Ask for no ketchup or mayo-style sauce."),
    I("6-piece Chicken McNuggets", [250, 14, 15, 15], "chicken wheat breading", "Use hot mustard or BBQ, not ranch."),
    I("10-piece Chicken McNuggets", [410, 23, 25, 25], "chicken wheat breading", "Pair with apple slices, not fries."),
    I("Hamburger", [250, 12, 31, 9], "beef bun wheat", "Add a second one if you're hungry."),
    I("Filet-O-Fish", [390, 16, 39, 19], "fish cheese bun wheat dairy tartar egg", "Hold the tartar sauce to save about 90."),
  ] },
  { chain: "Wendy's", items: [
    I("Grilled Chicken Sandwich", [370, 34, 36, 10], "chicken bun wheat", "The best protein for the calories on the menu."),
    I("Jr. Hamburger", [250, 13, 26, 10], "beef bun wheat", "Get two for 500 and 26g protein."),
    I("Jr. Cheeseburger", [290, 15, 26, 13], "beef cheese bun wheat dairy", ""),
    I("Dave's Single", [590, 30, 39, 34], "beef cheese bun wheat dairy mayo egg", "Hold the mayo to save about 90."),
    I("Spicy Chicken Sandwich", [500, 29, 50, 21], "chicken bun wheat mayo egg", ""),
    I("4-piece Chicken Nuggets", [170, 9, 10, 10], "chicken wheat breading", "Good for a small snack."),
    I("Small Chili", [220, 17, 23, 6], "beef beans", "Cheap, filling, and high in protein."),
    I("Plain baked potato", [270, 7, 61, 0], "potato", "Add chili on top to boost the protein."),
  ] },
  { chain: "Chipotle", items: [
    I("Chicken bowl: rice, black beans, fresh salsa, lettuce", [550, 44, 65, 13], "chicken rice beans", "Skip the rice to save about 210."),
    I("Double chicken salad: fajita veggies, salsa, no dressing", [410, 66, 12, 15], "chicken", "The best protein-for-calories order here."),
    I("Chicken bowl, no rice: beans, fajita veggies, salsa, lettuce", [360, 40, 28, 10], "chicken beans", "Add guac only if you have the room (+230)."),
    I("Steak bowl: rice, pinto beans, fajita veggies, salsa", [570, 38, 70, 15], "steak beef rice beans", ""),
    I("3 chicken soft tacos: salsa, lettuce", [520, 38, 52, 15], "chicken tortilla wheat gluten flour", "Skip the cheese and sour cream."),
    I("Chicken burrito: rice, beans, salsa", [830, 50, 100, 21], "chicken rice beans tortilla wheat gluten flour", "Turn it into a bowl to save about 320."),
  ] },
  { chain: "Qdoba", items: [
    I("Chicken bowl: rice, black beans, pico", [560, 42, 62, 15], "chicken rice beans", "Go half rice."),
    I("Chicken bowl, no rice: beans, fajita veggies, pico", [380, 38, 30, 11], "chicken beans", "Skip the queso."),
    I("Naked chicken burrito: lettuce, beans, pico", [420, 40, 32, 13], "chicken beans", ""),
    I("3 chicken soft tacos: pico, lettuce", [520, 36, 54, 17], "chicken tortilla wheat gluten flour", "Ask for just a little cheese."),
    I("Steak bowl: rice, pinto beans, pico", [590, 36, 66, 17], "steak beef rice beans", ""),
  ] },
  { chain: "Chick-fil-A", items: [
    I("Grilled Chicken Sandwich", [390, 28, 44, 12], "chicken bun wheat gluten", "Great pick. Get fruit cup on the side."),
    I("Chicken Sandwich", [440, 28, 41, 17], "chicken bun wheat gluten egg milk", ""),
    I("12-count Grilled Nuggets", [200, 38, 3, 4], "chicken", "The leanest protein on the menu."),
    I("8-count Grilled Nuggets", [130, 25, 2, 3], "chicken", "A light option with a side."),
    I("8-count Nuggets", [250, 27, 11, 11], "chicken wheat gluten egg milk breading", ""),
    I("Egg White Grill", [300, 27, 29, 8], "egg chicken english muffin wheat cheese dairy", "A solid breakfast.", true),
    I("Grilled Cool Wrap", [350, 37, 29, 14], "chicken tortilla wheat cheese dairy", ""),
  ] },
  { chain: "Subway", items: [
    I("6-inch Turkey Breast", [280, 18, 46, 4], "turkey bread wheat gluten", "Load up the veggies, go light on sauce."),
    I("6-inch Rotisserie-Style Chicken", [350, 29, 44, 6], "chicken bread wheat gluten", ""),
    I("6-inch Oven Roasted Chicken", [320, 23, 47, 5], "chicken bread wheat gluten", ""),
    I("6-inch Steak and Cheese", [380, 26, 47, 10], "steak beef cheese bread wheat gluten dairy", ""),
    I("6-inch Veggie Delite", [230, 9, 44, 3], "vegetarian veggie bread wheat gluten", "Add double cheese for more protein."),
    I("Rotisserie-Style Chicken salad bowl", [190, 23, 12, 4], "chicken", "No bread, so you save a lot of calories."),
  ] },
  { chain: "Taco Bell", items: [
    I("Chicken Soft Taco, fresco style", [140, 9, 15, 4], "chicken tortilla wheat gluten", "Order two or three. Fresco swaps the cheese for pico."),
    I("Crunchy Taco", [170, 8, 13, 10], "beef taco shell corn cheese dairy", ""),
    I("Power Menu Bowl with chicken", [470, 26, 50, 19], "chicken rice beans cheese sour cream dairy", "Hold the sour cream and sauce."),
    I("Bean Burrito", [380, 13, 55, 10], "vegetarian beans rice tortilla wheat gluten cheese dairy", ""),
    I("Chicken Quesadilla", [520, 27, 37, 28], "chicken cheese tortilla wheat gluten dairy", ""),
    I("Crunchwrap Supreme", [530, 16, 71, 21], "beef cheese tortilla wheat gluten dairy sour cream", ""),
  ] },
  { chain: "Starbucks", items: [
    I("Egg White and Roasted Red Pepper Egg Bites", [170, 12, 9, 8], "egg cheese dairy", "A good breakfast with a black coffee or unsweet tea.", true),
    I("Bacon and Gruyere Egg Bites", [300, 19, 9, 20], "egg bacon pork cheese dairy", "", true),
    I("Turkey Bacon, Cheddar and Egg White Sandwich", [230, 17, 28, 5], "egg turkey bacon cheese english muffin wheat gluten dairy", "", true),
    I("Spinach, Feta and Egg White Wrap", [290, 20, 34, 8], "egg cheese feta tortilla wheat gluten dairy vegetarian", "", true),
    I("Eggs and Cheddar Protein Box", [460, 23, 44, 22], "egg cheese cracker nuts dairy vegetarian", ""),
  ] },
  { chain: "Panera", items: [
    I("Mediterranean Greek Salad with chicken", [400, 30, 18, 24], "chicken cheese feta dairy olive", "Ask for dressing on the side."),
    I("Turkey Sandwich, half, with a cup of broth soup", [370, 25, 45, 9], "turkey bread wheat gluten", ""),
    I("Chicken Tortilla Soup, bowl", [380, 24, 40, 14], "chicken tortilla cheese dairy", ""),
    I("Ten Vegetable Soup, bowl", [120, 5, 21, 3], "vegetarian vegan vegetable", "Add a protein side to fill up."),
    I("Avocado, Egg White and Spinach Breakfast Power Sandwich", [330, 20, 31, 13], "egg avocado bread wheat gluten", "", true),
  ] },
  { chain: "Whataburger", items: [
    I("Whataburger Jr.", [310, 14, 36, 13], "beef bun wheat gluten", ""),
    I("Whataburger", [590, 29, 59, 27], "beef bun wheat gluten", "Hold the mayo-style sauce."),
    I("Grilled Chicken Sandwich", [430, 37, 43, 14], "chicken bun wheat gluten", "Your leanest choice here."),
    I("Whataburger Jr. with cheese, no bun (lettuce wrap)", [210, 15, 6, 14], "beef cheese dairy", ""),
  ] },
  { chain: "Raising Cane's", items: [
    I("3 Chicken Fingers, no sauce", [390, 36, 21, 24], "chicken wheat gluten egg", "Skip the sauce and fries. Take the coleslaw instead."),
    I("3 Chicken Fingers with Cane's Sauce", [580, 37, 29, 38], "chicken wheat gluten egg", ""),
    I("Chicken Finger Sandwich, no sauce", [450, 25, 38, 20], "chicken bun texas toast wheat gluten egg", ""),
  ] },
  { chain: "Panda Express", items: [
    I("Grilled Teriyaki Chicken with Super Greens", [365, 39, 19, 16], "chicken soy vegetables", "The best order here."),
    I("Broccoli Beef with Super Greens", [240, 15, 23, 10], "beef soy broccoli", ""),
    I("Orange Chicken with Super Greens", [600, 32, 62, 26], "chicken wheat gluten soy breaded", "Get a half portion of the chicken."),
    I("Grilled Teriyaki Chicken with half Steamed Rice", [465, 36, 52, 13], "chicken soy rice", ""),
  ] },
  { chain: "Jimmy John's", items: [
    I("Turkey Tom Unwich (lettuce wrap)", [200, 20, 6, 10], "turkey mayo egg", "Hold the mayo to save about 90."),
    I("#4 Turkey Tom, 8-inch", [540, 30, 68, 17], "turkey bread wheat gluten mayo egg", ""),
    I("Slim 3 Turkey and Provolone", [320, 21, 40, 8], "turkey cheese provolone bread wheat gluten dairy", ""),
  ] },
  { chain: "Burger King", items: [
    I("Hamburger", [250, 13, 27, 10], "beef bun wheat gluten", ""),
    I("Whopper Jr.", [340, 15, 30, 18], "beef bun wheat gluten mayo egg", "Hold the mayo."),
    I("Whopper", [670, 31, 51, 40], "beef bun wheat gluten mayo egg", "Hold the mayo to save about 90."),
    I("4-piece Chicken Nuggets", [170, 9, 10, 11], "chicken wheat gluten breading", ""),
    I("Egg and Cheese Croissan'wich", [340, 13, 28, 20], "egg cheese croissant wheat gluten dairy", "", true),
  ] },
  { chain: "Five Guys", items: [
    I("Little Hamburger", [480, 23, 39, 26], "beef bun wheat gluten", "Get it in a lettuce wrap to cut about 180."),
    I("Little Cheeseburger", [550, 27, 40, 32], "beef cheese bun wheat gluten dairy", ""),
    I("Little Hamburger in a bowl (no bun)", [300, 21, 6, 22], "beef", "A good lower-carb pick."),
    I("Veggie Sandwich", [440, 12, 45, 24], "vegetarian bun wheat gluten", ""),
  ] },
  { chain: "Jersey Mike's", items: [
    I("Mini Turkey and Provolone", [390, 25, 41, 14], "turkey cheese provolone bread wheat gluten dairy", "Ask for it light on oil."),
    I("Turkey sub in a tub (no bread)", [270, 24, 8, 16], "turkey cheese provolone dairy", ""),
    I("Mini Grilled Chicken sandwich, no mayo", [430, 29, 46, 14], "chicken bread wheat gluten", ""),
  ] },
  { chain: "Popeyes", items: [
    I("3 Blackened Chicken Tenders", [170, 26, 2, 6], "chicken", "Lean protein. Add green beans."),
    I("3 Classic Chicken Tenders", [340, 29, 17, 17], "chicken wheat gluten breading", ""),
    I("Green Beans", [60, 2, 8, 3], "vegetarian vegetable", "A good side."),
    I("Classic Chicken Sandwich", [700, 28, 50, 42], "chicken bun wheat gluten mayo egg", "Save this for a treat."),
  ] },
  { chain: "KFC", items: [
    I("Kentucky Grilled Chicken Breast", [210, 38, 0, 7], "chicken", "The leanest protein you can get."),
    I("Original Recipe Chicken Breast", [390, 39, 11, 21], "chicken wheat gluten breading", "Peel off the skin to save about 100."),
    I("2 Original Recipe Drumsticks", [260, 24, 8, 16], "chicken wheat gluten breading", ""),
    I("Green Beans", [25, 1, 5, 0], "vegetarian vegetable", ""),
    I("Mashed Potatoes, no gravy", [110, 2, 17, 4], "vegetarian potato milk dairy butter", ""),
  ] },
  { chain: "Pizza Hut", items: [
    I("2 slices thin crust cheese pizza", [440, 20, 48, 20], "cheese dairy wheat gluten crust", "Blot the grease with a napkin."),
    I("2 slices thin crust veggie pizza", [400, 17, 50, 16], "vegetarian cheese dairy wheat gluten crust vegetables", ""),
    I("2 slices thin crust chicken and veggie pizza", [420, 24, 48, 15], "chicken cheese dairy wheat gluten crust", ""),
  ] },
  { chain: "Domino's", items: [
    I("2 slices thin crust veggie pizza", [380, 16, 44, 15], "vegetarian cheese dairy wheat gluten crust vegetables", ""),
    I("2 slices thin crust chicken pizza", [400, 22, 42, 16], "chicken cheese dairy wheat gluten crust", ""),
    I("4 plain bone-in chicken wings", [360, 30, 1, 26], "chicken", "Skip the dipping sauce."),
    I("Garden salad with grilled chicken", [220, 20, 12, 10], "chicken cheese dairy", "Use light dressing."),
  ] },
  { chain: "Gas station or store", items: [
    I("2 hard-boiled eggs", [140, 12, 1, 10], "egg", "Often by the register or in the cooler.", true),
    I("Beef jerky, 1 oz", [80, 13, 3, 1], "beef soy", "Check the label. Salt is high."),
    I("String cheese", [80, 7, 1, 6], "cheese dairy vegetarian", ""),
    I("Greek yogurt cup", [130, 12, 14, 3], "yogurt dairy vegetarian", "Pick plain or light, not the fruit-on-bottom ones.", true),
    I("Protein shake, 30g", [160, 30, 5, 3], "milk dairy whey vegetarian", "Choose a ready-to-drink one."),
    I("Protein bar (about 20g protein)", [200, 20, 22, 8], "nuts peanut soy dairy whey vegetarian", "Check the label for 15g protein or more."),
    I("Banana and a handful of almonds", [260, 8, 33, 14], "vegetarian vegan fruit nuts almond", ""),
    I("Turkey and cheese sandwich, pre-packed", [400, 24, 38, 16], "turkey cheese bread wheat gluten dairy mayo egg", ""),
    I("Cottage cheese cup", [110, 12, 5, 4], "cottage cheese dairy vegetarian", ""),
    I("Tuna pack with crackers", [180, 17, 17, 5], "fish tuna cracker wheat gluten", ""),
  ] },
];

export const ROAD_CHAINS = FAST_FOOD.map((c) => c.chain);

// Best orders across every chain for what's left today. Returns items with .chain filled in.
export function roadPicks(slot, remainCal = Infinity, remainP = 0, avoid = null, chain = "", limit = 12, sort = "") {
  const all = FAST_FOOD.filter((c) => !chain || c.chain === chain)
    .flatMap((c) => c.items.map((m) => ({ ...m, chain: c.chain })))
    .filter((m) => mealOk({ name: m.name, tags: `${m.chain} ${m.t}`, blurb: "", carbs: m.carbs }, avoid));
  const pool = all.filter((m) => (slot === "Breakfast" ? m.b : slot === "Snack" ? m.calories <= 300 : !m.b && m.calories >= 200));
  const scored = pool.map((m) => {
    const fits = Number.isFinite(remainCal) && remainCal > 0 ? (m.calories <= remainCal ? 1 : m.calories <= remainCal * 1.1 ? 0 : -1) : 0;
    return { m, score: fits * 4 + (m.protein * 4 / Math.max(1, m.calories)) * 10 + Math.min(m.protein, 40) / 10 };
  });
  let list = scored;
  if (Number.isFinite(remainCal) && remainCal > 0) {
    const fit = scored.filter((x) => x.m.calories <= remainCal * 1.1);
    if (fit.length >= 3) list = fit;
  }
  const by = {
    protein: (a, b) => b.m.protein - a.m.protein || a.m.calories - b.m.calories,
    calories: (a, b) => a.m.calories - b.m.calories || b.m.protein - a.m.protein,
    ratio: (a, b) => b.m.protein / b.m.calories - a.m.protein / a.m.calories,
  }[sort] || ((a, b) => b.score - a.score);
  return list.sort(by).slice(0, limit).map((x) => x.m);
}

// Quick order tweaks. d = [calories, protein, carbs, fat] change. Estimates for a typical portion.
const meatKind = (m) => (/chicken/i.test(`${m.name} ${m.t}`) ? "chicken" : /steak/i.test(`${m.name} ${m.t}`) ? "steak" : /turkey/i.test(`${m.name} ${m.t}`) ? "turkey" : /beef/i.test(`${m.name} ${m.t}`) ? "beef" : "");
const DOUBLE = { chicken: [170, 30, 0, 6], steak: [150, 21, 0, 6], beef: [180, 22, 0, 10], turkey: [110, 22, 0, 2] };
export const MODS = [
  { id: "nocheese", label: "No cheese", test: (m) => /cheese|cheddar|provolone/i.test(`${m.name} ${m.t}`) && !/no cheese|cottage|string cheese|egg bites/i.test(m.name), d: () => [-90, -5, -1, -7] },
  { id: "nomayo", label: "No mayo or sauce", test: (m) => /mayo|tartar|ranch|sour cream/i.test(m.t) && !/unwich|lettuce wrap/i.test(m.name) || /mayo|tartar/i.test(m.t), d: () => [-90, 0, 0, -10] },
  { id: "nobun", label: "No bun or bread", test: (m) => /\bbun\b|bread|english muffin|croissant|texas toast/i.test(`${m.t} ${m.name}`) && !/tortilla|no bun|unwich|bowl|lettuce wrap|in a tub/i.test(m.name), d: () => [-140, -5, -27, -2] },
  { id: "notortilla", label: "Skip the tortilla (bowl)", test: (m) => /tortilla/i.test(m.t) && !/bowl|salad|tub/i.test(m.name) && !/taco/i.test(m.name), d: () => [-180, -6, -30, -5] },
  { id: "double", label: "Double the meat", test: (m) => !!meatKind(m) && /bowl|salad|taco|burrito|wrap|quesadilla|sub\b|sandwich|power menu/i.test(m.name) && !/nugget|tender|finger|wing/i.test(m.name), d: (m) => DOUBLE[meatKind(m)] },
  { id: "patty", label: "Extra patty", test: (m) => /beef/i.test(m.t) && /burger|whopper|quarter pounder|dave's|whataburger|hamburger/i.test(m.name), d: () => [170, 13, 0, 13] },
];
export const modsFor = (m) => MODS.filter((x) => x.test(m));
export function applyMods(m, ids) {
  let out = { ...m, mods: [] };
  for (const id of ids || []) {
    const x = MODS.find((y) => y.id === id);
    if (!x || out.mods.includes(id) || !x.test(m)) continue;
    const [c, p, cb, f] = x.d(m);
    out = { ...out, mods: [...out.mods, id], calories: Math.max(0, out.calories + c), protein: Math.max(0, out.protein + p), carbs: Math.max(0, out.carbs + cb), fat: Math.max(0, out.fat + f) };
  }
  return out;
}
export const modLabel = (id) => (MODS.find((x) => x.id === id) || {}).label || id;

// ---- finding a restaurant: search with nicknames, your most visited, and the usual popular places ----
export const POPULAR_CHAINS = ["McDonald's", "Chick-fil-A", "Chipotle", "Subway", "Starbucks", "Taco Bell", "Wendy's", "Panera", "Raising Cane's", "Jimmy John's"];
const ALIASES = {
  "McDonald's": ["mcdonalds", "mcd", "mickey ds", "mickey d"], "Chick-fil-A": ["chickfila", "chick fil a", "cfa"], "Burger King": ["bk"],
  "Jimmy John's": ["jimmy johns", "jj", "jjs"], "Jersey Mike's": ["jersey mikes", "jm"], "Domino's": ["dominos", "pizza"], "Wendy's": ["wendys"],
  "Raising Cane's": ["canes", "raising canes"], "Taco Bell": ["tacobell"], "Panda Express": ["panda", "chinese"], "Starbucks": ["sbux", "coffee"],
  "Gas station or store": ["gas", "convenience", "store", "7 eleven", "7eleven", "caseys", "kwik trip", "maverik", "circle k", "love's", "loves", "pilot", "truck stop"],
  "Subway": ["subs", "sub"], "Pizza Hut": ["pizza", "pizzahut"], "Five Guys": ["5 guys", "fiveguys"], "Whataburger": ["whata"], "Chipotle": ["chipolte", "burrito", "mexican"],
  "Qdoba": ["mexican", "burrito"], "Popeyes": ["popeye", "chicken"], "KFC": ["kentucky", "chicken"], "Panera": ["panera bread"],
};
export const normName = (s) => String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Best matches first: starts with the typed text, then a word that starts with it, then anywhere in the name or a nickname.
export function searchChains(query, limit = 6) {
  const q = normName(query);
  if (!q) return [];
  const scored = ROAD_CHAINS.map((chain) => {
    const names = [normName(chain), ...(ALIASES[chain] || []).map(normName)];
    let best = 0;
    for (const [i, n] of names.entries()) {
      const w = i === 0 ? 1 : 0.9;
      if (n === q) best = Math.max(best, 5 * w);
      else if (n.startsWith(q)) best = Math.max(best, 4 * w);
      else if (n.split(" ").some((x) => x.startsWith(q))) best = Math.max(best, 3 * w);
      else if (n.includes(q)) best = Math.max(best, 2 * w);
    }
    return { chain, best };
  }).filter((x) => x.best > 0);
  return scored.sort((a, b) => b.best - a.best || ROAD_CHAINS.indexOf(a.chain) - ROAD_CHAINS.indexOf(b.chain)).slice(0, limit).map((x) => x.chain);
}

// Orders logged from here end in "(Chain)". Count how often each place shows up in your history.
export function visitCounts(days) {
  const counts = {};
  for (const d of Object.values(days || {})) for (const f of d?.foods || []) {
    const m = /\(([^()]+)\)\s*$/.exec(String(f?.name || ""));
    if (m && ROAD_CHAINS.includes(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;
}

// mine: the places you order from most. popular: the usual favorites you haven't used yet. rest: everything else, in list order.
export function chainGroups(counts) {
  const mine = Object.entries(counts || {}).sort((a, b) => b[1] - a[1] || ROAD_CHAINS.indexOf(a[0]) - ROAD_CHAINS.indexOf(b[0])).slice(0, 5).map(([c]) => c);
  const popular = POPULAR_CHAINS.filter((c) => ROAD_CHAINS.includes(c) && !mine.includes(c));
  const rest = ROAD_CHAINS.filter((c) => !mine.includes(c) && !popular.includes(c));
  return { mine, popular, rest };
}
