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

// USDA's Foundation foods - the lab-analysed, highest quality entries - often
// report energy under the Atwater nutrients rather than the classic 1008.
// Reading only 1008 silently dropped them. Fall through until one has a value.
function energy(nutrients) {
  for (const id of [1008, 2048, 2047]) {
    const v = pick(nutrients, id);
    if (v > 0) return v;
  }
  const kj = pick(nutrients, 1062);
  return kj > 0 ? kj / 4.184 : 0;
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
      m: [energy(f.foodNutrients), pick(f.foodNutrients, N.protein),
          pick(f.foodNutrients, N.carbs), pick(f.foodNutrients, N.fat)].map((v) => Math.round(v * 10) / 10),
    })).filter((f) => f.m[0] > 0);

    return json({ foods });
  }

  if (body.op === "barcode") {
    const bc = String(body.barcode || "").replace(/\D/g, "");
    if (bc.length < 6) return json({ food: null, reason: "That doesn't look like a barcode." });
    const r1 = (v) => Math.round(Number(v || 0) * 10) / 10;

    // 1) Open Food Facts: packaged goods, straight off the label.
    try {
      const r = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${bc}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity,quantity`,
        { headers: { "User-Agent": "CutLog/1.0 (personal food log)" } }
      );
      const d = await r.json().catch(() => null);
      // Open Food Facts answers 200 with status 0 for unknown products. Trust the payload, not the status code.
      if (d && d.status === 1 && d.product) {
        const n = d.product.nutriments || {};
        const cal = Number(n["energy-kcal_100g"] ?? 0);
        if (cal) {
          const sg = Number(d.product.serving_quantity) || 0;
          return json({
            food: {
              name: [d.product.brands?.split(",")[0], d.product.product_name].filter(Boolean).join(" ").trim() || `Barcode ${bc}`,
              source: "Label",
              m: [cal, n.proteins_100g, n.carbohydrates_100g, n.fat_100g].map(r1),
              ...(sg > 0 ? { s: { g: sg, label: `serving (${Math.round(sg)} g)` } } : {}),
              extra: { fiber: r1(n.fiber_100g), sugar: r1(n.sugars_100g), sodiumMg: Math.round(Number(n.sodium_100g || 0) * 1000), satFat: r1(n["saturated-fat_100g"]) },
              size: d.product.serving_size || "",
            },
          });
        }
      }
    } catch { /* fall through to USDA */ }

    // 2) USDA branded foods carry the UPC too.
    try {
      const key = Netlify.env.get("USDA_API_KEY") || "DEMO_KEY";
      const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(bc)}&dataType=Branded&pageSize=5`);
      if (r.ok) {
        const d = await r.json();
        const strip = (x) => String(x || "").replace(/\D/g, "").replace(/^0+/, "");
        const f = (d.foods || []).find((x) => strip(x.gtinUpc) === strip(bc));
        if (f) {
          const cal = energy(f.foodNutrients);
          if (cal > 0) {
            const sg = (f.servingSizeUnit || "").toLowerCase().startsWith("g") || (f.servingSizeUnit || "").toLowerCase() === "ml" ? Number(f.servingSize) : 0;
            return json({
              food: {
                name: [tidy(f.brandName || f.brandOwner), tidy(f.description)].filter(Boolean).join(" ").trim() || `Barcode ${bc}`,
                source: "Label",
                m: [cal, pick(f.foodNutrients, N.protein), pick(f.foodNutrients, N.carbs), pick(f.foodNutrients, N.fat)].map(r1),
                ...(sg > 0 ? { s: { g: sg, label: `serving (${Math.round(sg)} g)` } } : {}),
                extra: { fiber: r1(pick(f.foodNutrients, 1079)), sugar: r1(pick(f.foodNutrients, 2000)), sodiumMg: Math.round(pick(f.foodNutrients, 1093)), satFat: r1(pick(f.foodNutrients, 1258)) },
                size: f.householdServingFullText || "",
              },
            });
          }
        }
      }
    } catch { /* nothing more to try */ }

    return json({ food: null, reason: "Not in the database yet. Use Label to photograph the panel, or Weigh to enter it." });
  }

  return new Response("Unknown op", { status: 400 });
};

export const config = { path: "/api/food" };
