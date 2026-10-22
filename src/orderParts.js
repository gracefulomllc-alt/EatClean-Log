import { MODS } from "./fastFood.js";

// "Edit this order": every order gets a list of parts you can take out and extras you can add.
// kind "in"  = part of the order as listed. Turning it off removes it (d is the change, already negative).
// kind "add" = an extra. Turning it on adds it.
// d = [calories, protein, carbs, fat]. These are typical-portion estimates (Chipotle's are from its published numbers).
const MEX = /bowl|burrito|taco|salad|quesadilla|nachos/i;
const SANDWICH = /burger|sandwich|\bsub\b|wrap|biscuit|whopper|hamburger|panini|melt/i;

// Things you can take out when the order names them.
const IN = [
  { id: "norice", label: "Rice", re: /\brice\b/i, d: [210, 4, 40, 4] },
  { id: "nobeans", label: "Beans", re: /\bbeans\b/i, d: [130, 8, 22, 1.5] },
  { id: "nosalsa", label: "Salsa or pico", re: /\b(salsa|pico)\b/i, d: [25, 0, 5, 0] },
  { id: "noveg", label: "Fajita veggies", re: /fajita veggies/i, d: [20, 1, 5, 0] },
  { id: "nolettuce", label: "Lettuce", re: /\blettuce\b/i, d: [5, 0, 1, 0] },
  { id: "nosour", label: "Sour cream", re: /sour cream/i, d: [110, 2, 2, 9] },
  { id: "noguac", label: "Guacamole", re: /guac/i, d: [230, 2, 8, 22] },
  { id: "nobacon", label: "Bacon", re: /bacon/i, d: [80, 6, 0, 6] },
];
// Extras, by the kind of order.
const ADD_MEX = [
  { id: "addrice", label: "Rice", d: [210, 4, 40, 4], skip: /\brice\b|no rice/i },
  { id: "addbeans", label: "Beans", d: [130, 8, 22, 1.5], skip: /\bbeans\b/i },
  { id: "addsalsa", label: "Salsa", d: [25, 0, 5, 0], skip: /\b(salsa|pico)\b/i },
  { id: "addguac", label: "Guacamole", d: [230, 2, 8, 22], skip: /guac/i },
  { id: "addcheese", label: "Cheese", d: [110, 6, 1, 8], skip: /cheese/i },
  { id: "addsour", label: "Sour cream", d: [110, 2, 2, 9], skip: /sour cream/i },
  { id: "addqueso", label: "Queso", d: [120, 5, 4, 9], skip: /queso/i },
];
const ADD_SAND = [
  { id: "addcheese", label: "Cheese", d: [90, 5, 1, 7], skip: /cheese/i },
  { id: "addavo", label: "Avocado", d: [70, 1, 4, 6], skip: /avocado|guac/i },
  { id: "addbacon", label: "Bacon", d: [80, 6, 0, 6], skip: /bacon/i },
  { id: "addmayo", label: "Mayo or sauce", d: [90, 0, 0, 10], skip: /mayo|sauce/i },
];
// One scoop of meat is different at each place. Chipotle publishes its numbers.
const DOUBLE_CHIPOTLE = { chicken: [180, 32, 0, 7], steak: [150, 21, 1, 6] };
const meatKind = (m) => { const s = `${m.name} ${m.t || ""}`; return /chicken/i.test(s) ? "chicken" : /steak/i.test(s) ? "steak" : /turkey/i.test(s) ? "turkey" : /beef/i.test(s) ? "beef" : ""; };
const DOUBLE = { chicken: [170, 30, 0, 6], steak: [150, 21, 0, 6], beef: [180, 22, 0, 10], turkey: [110, 22, 0, 2] };

export function orderParts(m) {
  const parts = [];
  const name = m.name || "";
  for (const x of IN) if (x.re.test(name) && !new RegExp(`no ${x.re.source}`, "i").test(name)) parts.push({ id: x.id, kind: "in", label: x.label, d: x.d.map((v) => -v) });
  // the older one-tap tweaks still apply: cheese, mayo, bread and tortilla come out, meat doubles, extra patty
  for (const x of MODS) {
    if (!x.test(m)) continue;
    if (x.id === "double") {
      const k = meatKind(m), d = (m.chain === "Chipotle" && DOUBLE_CHIPOTLE[k]) || DOUBLE[k];
      if (d) parts.push({ id: "double", kind: "add", label: `Double the ${k}`, d });
    } else if (x.id === "patty") parts.push({ id: "patty", kind: "add", label: "Extra patty", d: x.d(m) });
    else parts.push({ id: x.id, kind: "in", label: x.label.replace(/^No /, "").replace(/^Skip the /, ""), d: x.d(m) });
  }
  const adds = MEX.test(name) && !SANDWICH.test(name) ? ADD_MEX : SANDWICH.test(name) ? ADD_SAND : [];
  const hasCheeseIn = parts.some((p) => p.id === "nocheese");
  for (const x of adds) {
    if (x.skip.test(`${name} ${m.t || ""}`.replace(/no (rice|cheese|beans)/gi, "")) || parts.some((p) => p.id === x.id)) continue;
    if (x.id === "addcheese" && hasCheeseIn) continue;
    parts.push({ id: x.id, kind: "add", label: x.label, d: x.d });
  }
  return parts;
}

// ids = the parts you changed: "in" parts you took out, "add" parts you put on.
export function applyParts(m, ids) {
  const parts = orderParts(m), on = parts.filter((p) => (ids || []).includes(p.id));
  const sum = on.reduce((a, p) => a.map((v, i) => v + p.d[i]), [0, 0, 0, 0]);
  return {
    ...m, parts: on.map((p) => p.id),
    calories: Math.max(0, Math.round(m.calories + sum[0])), protein: Math.max(0, Math.round(m.protein + sum[1])),
    carbs: Math.max(0, Math.round(m.carbs + sum[2])), fat: Math.max(0, Math.round(m.fat + sum[3])),
  };
}

// "Chicken bowl (edited: no rice, no beans, double the chicken, plus guacamole)"
export function partsLabel(m, ids) {
  const on = orderParts(m).filter((p) => (ids || []).includes(p.id));
  if (!on.length) return m.name;
  const bits = on.map((p) => (p.kind === "in" ? `no ${p.label.toLowerCase()}` : /^double|^extra/i.test(p.label) ? p.label.toLowerCase() : `plus ${p.label.toLowerCase()}`));
  return `${String(m.name).split(":")[0]} (edited: ${bits.join(", ")})`;
}
