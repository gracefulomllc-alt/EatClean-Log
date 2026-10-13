// The barcode lookup: Open Food Facts first, USDA branded as backup, honest message when neither knows it.
globalThis.Netlify = { env: { get: () => "" } };
const h = (await import("../netlify/functions/food.js")).default;
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const ask = async (bc) => (await h(new Request("http://x/api/food", { method: "POST", body: JSON.stringify({ op: "barcode", barcode: bc }) }))).json();
const reply = (o) => new Response(JSON.stringify(o), { status: 200 });
let mode = "off";
globalThis.fetch = async (url) => {
  if (String(url).includes("openfoodfacts")) return reply(mode === "off" ? { status: 1, product: { product_name: "Protein Bar", brands: "Acme,Other", serving_quantity: 60, serving_size: "1 bar (60 g)", nutriments: { "energy-kcal_100g": 350, proteins_100g: 33, carbohydrates_100g: 36, fat_100g: 11, fiber_100g: 8, sugars_100g: 2.5, sodium_100g: 0.4, "saturated-fat_100g": 4 } } } : { status: 0 });
  if (mode === "none") return reply({ foods: [] });
  return reply({ foods: [{ gtinUpc: "000012345678", description: "CRUNCHY PEANUT BUTTER", brandName: "NUTCO", servingSize: 32, servingSizeUnit: "g", foodNutrients: [{ nutrientId: 1008, value: 590 }, { nutrientId: 1003, value: 25 }, { nutrientId: 1005, value: 20 }, { nutrientId: 1004, value: 50 }, { nutrientId: 1093, value: 420 }] }] });
};
let r = await ask("0012345678905");
t(r.food?.name === "Acme Protein Bar" && r.food.m[0] === 350 && r.food.s.g === 60 && r.food.extra.sodiumMg === 400 && r.food.extra.fiber === 8, "Open Food Facts result with serving and extras");
mode = "usda"; r = await ask("12345678");
t(r.food?.name === "Nutco Crunchy peanut butter" && r.food.m[0] === 590 && r.food.s.g === 32 && r.food.extra.sodiumMg === 420, "falls back to USDA branded by UPC: " + JSON.stringify(r.food?.name));
mode = "none"; r = await ask("99999999999");
t(r.food === null && /Not in the database/.test(r.reason), "unknown code gives a plain message");
r = await ask("12"); t(r.food === null && /barcode/.test(r.reason), "too short");
console.log(`${ok} ok ${bad} bad`); process.exit(bad ? 1 : 0);
