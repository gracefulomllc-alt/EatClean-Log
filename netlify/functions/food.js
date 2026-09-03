// Real nutrition data, not a language model's recollection.
//   USDA FoodData Central  - lab-analysed whole foods, per 100 g
//   Open Food Facts        - packaged goods by barcode, straight off the label
// Both are free. USDA_API_KEY is optional; without it we fall back to the
// heavily rate-limited DEMO_KEY. Get a real one at fdc.nal.usda.gov/api-key-signup

const USDA_TYPES = "Foundation,SR Legacy,Survey (FNDDS)";
const N = { cal: 1008, protein: 1003, fat: 1004, carbs: 1005 };

const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

function pick(nutrients, id) {
  const hit = (nutrients || []).find((x) => (x.nutrientId ?? x.nutrient?.id) === id);
  return hit ? Number(hit.value ?? hit.amount ?? 0) : 0;
}

// USDA descriptions are shouty and comma-heavy: "CHICKEN, BROILERS, BREAST, MEAT ONLY, COOKED"
function tidy(s) {
  const t = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const code = Netlify.env.get("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) {
    return new Response("Bad access code", { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  if (body.op === "search") {
    const q = String(body.query || "").trim();
    if (q.length < 2) return json({ foods: [] });

    const key = Netlify.env.get("USDA_API_KEY") || "DEMO_KEY";
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`
      + `&query=${encodeURIComponent(q)}&dataType=${encodeURIComponent(USDA_TYPES)}&pageSize=8`;

    const r = await fetch(url);
    if (!r.ok) return new Response(`USDA error ${r.status}`, { status: r.status });
    const d = await r.json();

    const foods = (d.foods || []).map((f) => ({
      name: tidy(f.description),
      source: "USDA",
      m: [pick(f.foodNutrients, N.cal), pick(f.foodNutrients, N.protein),
          pick(f.foodNutrients, N.carbs), pick(f.foodNutrients, N.fat)].map((v) => Math.round(v * 10) / 10),
    })).filter((f) => f.m[0] > 0);

    return json({ foods });
  }

  if (body.op === "barcode") {
    const bc = String(body.barcode || "").replace(/\D/g, "");
    if (bc.length < 6) return json({ food: null, reason: "That doesn't look like a barcode." });

    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${bc}.json?fields=product_name,brands,nutriments`,
      { headers: { "User-Agent": "CutLog/1.0 (personal food log)" } }
    );
    const d = await r.json().catch(() => null);

    // Open Food Facts answers 200 with status 0 for unknown products.
    // Trust the payload, not the status code.
    if (!d || d.status !== 1 || !d.product) {
      return json({ food: null, reason: "Not in the database. Weigh it or enter it by hand." });
    }

    const n = d.product.nutriments || {};
    const cal = Number(n["energy-kcal_100g"] ?? 0);
    if (!cal) return json({ food: null, reason: "That product has no calorie data on file." });

    return json({
      food: {
        name: [d.product.brands?.split(",")[0], d.product.product_name].filter(Boolean).join(" ").trim() || `Barcode ${bc}`,
        source: "Label",
        m: [cal, Number(n.proteins_100g ?? 0), Number(n.carbohydrates_100g ?? 0), Number(n.fat_100g ?? 0)]
             .map((v) => Math.round(v * 10) / 10),
      },
    });
  }

  return new Response("Unknown op", { status: 400 });
};

export const config = { path: "/api/food" };
