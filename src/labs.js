// Lab results -> which parts of a meal matter more for you. General adult reference ranges, not a diagnosis.
// "heart" = cholesterol / triglycerides, "sugar" = blood sugar / liver markers. Only the newest value of each marker counts.

const num = (v) => { const m = /-?\d+(\.\d+)?/.exec(String(v ?? "").replace(/,/g, "")); return m ? parseFloat(m[0]) : NaN; };
const key = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function latestLabs(labs) {
  const best = {};
  for (const l of labs || []) {
    const k = key(l?.name); if (!k || isNaN(num(l.value))) continue;
    const cur = best[k];
    if (!cur || String(l.date || "") > String(cur.date || "") || (l.date === cur.date && (l.u || 0) > (cur.u || 0))) best[k] = l;
  }
  return best;
}

export function labFocus(labs) {
  const L = latestLabs(labs), v = (...names) => { for (const n of names) if (L[key(n)]) return num(L[key(n)].value); return NaN; };
  const hints = [];
  const ldl = v("LDL"), tc = v("Total cholesterol", "Cholesterol"), tg = v("Triglycerides"), hdl = v("HDL");
  const a1c = v("A1c", "HbA1c"), glu = v("Fasting glucose", "Glucose"), alt = v("ALT"), ast = v("AST");
  const vd = v("Vitamin D"), fer = v("Ferritin");
  let heart = false, sugar = false;
  if (ldl >= 130 || tc >= 200 || tg >= 150 || hdl < 40) { heart = true; hints.push("Keep saturated fat, fried food and processed meat low; favor fish, beans, oats, olive oil and vegetables."); }
  if (a1c >= 5.7 || glu >= 100 || alt > 40 || ast > 40) { sugar = true; hints.push("Keep added sugar, sweet drinks and refined carbs low; pair carbs with protein and fiber."); }
  if (vd < 30) hints.push("Include vitamin D foods like salmon, eggs and fortified milk.");
  if (fer < 30) hints.push("Include iron-rich foods like beef, beans and spinach with some vitamin C.");
  return { heart, sugar, any: heart || sugar || hints.length > 0, hints };
}

// Turn what the model read off a report into clean rows. Never trusts it blindly.
export function parseLabReport(p, today) {
  const rows = Array.isArray(p?.labs) ? p.labs : Array.isArray(p) ? p : [];
  const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && !isNaN(Date.parse(d)) && String(d) <= today;
  const date = okDate(p?.date) ? p.date : today, seen = new Set(), out = [];
  for (const r of rows) {
    const name = String(r?.name || "").replace(/\s+/g, " ").trim().slice(0, 40), n = num(r?.value);
    if (!name || isNaN(n)) continue;
    const value = String(r.value).trim().slice(0, 12), unit = String(r?.unit || "").trim().slice(0, 16);
    const d = okDate(r?.date) ? r.date : date, k = key(name) + "|" + d;
    if (seen.has(k)) continue; seen.add(k);
    out.push({ name, value, unit, date: d });
  }
  return out.slice(0, 40);
}

// Add new rows without duplicating a marker you already entered for that date.
export function mergeNewLabs(existing, rows, mkId, now = Date.now()) {
  const have = new Set((existing || []).map((l) => key(l.name) + "|" + l.date));
  const add = rows.filter((r) => !have.has(key(r.name) + "|" + r.date)).map((r) => ({ id: mkId(), ...r, u: now }));
  return { labs: [...add, ...(existing || [])].slice(0, 150), added: add.length };
}
