// Fresh fruit by the cup or by the piece. Per 1 unit, from USDA averages: [calories, protein g, carbs g, fat g, fiber g].
// cup-based fruits slide in quarter cups; piece-based ones in halves.
export const FRUITS = [
  { n: "Grapes", unit: "cup", per: [104, 1.1, 27, 0.2, 1.4], max: 3 },
  { n: "Strawberries", unit: "cup", per: [49, 1.0, 11.7, 0.5, 3.0], max: 3 },
  { n: "Blueberries", unit: "cup", per: [84, 1.1, 21.4, 0.5, 3.6], max: 3 },
  { n: "Raspberries", unit: "cup", per: [64, 1.5, 14.7, 0.8, 8.0], max: 3 },
  { n: "Blackberries", unit: "cup", per: [62, 2.0, 13.8, 0.7, 7.6], max: 3 },
  { n: "Cherries", unit: "cup", per: [87, 1.5, 22, 0.3, 2.9], max: 3 },
  { n: "Watermelon", unit: "cup", per: [46, 0.9, 11.5, 0.2, 0.6], max: 4 },
  { n: "Cantaloupe", unit: "cup", per: [54, 1.3, 13, 0.3, 1.4], max: 4 },
  { n: "Honeydew", unit: "cup", per: [61, 0.9, 15.5, 0.2, 1.4], max: 4 },
  { n: "Pineapple", unit: "cup", per: [82, 0.9, 21.6, 0.2, 2.3], max: 3 },
  { n: "Mango", unit: "cup", per: [99, 1.4, 24.7, 0.6, 2.6], max: 3 },
  { n: "Pomegranate seeds", unit: "cup", per: [144, 3.0, 32.5, 2.0, 7.0], max: 2 },
  { n: "Banana", unit: "banana", per: [105, 1.3, 27, 0.4, 3.1], max: 4 },
  { n: "Apple", unit: "apple", per: [95, 0.5, 25, 0.3, 4.4], max: 4 },
  { n: "Orange", unit: "orange", per: [62, 1.2, 15.4, 0.2, 3.1], max: 4 },
  { n: "Pear", unit: "pear", per: [101, 0.6, 27, 0.2, 5.5], max: 4 },
  { n: "Peach", unit: "peach", per: [59, 1.4, 14.3, 0.4, 2.3], max: 4 },
  { n: "Plum", unit: "plum", per: [30, 0.5, 7.5, 0.2, 0.9], max: 6 },
  { n: "Kiwi", unit: "kiwi", per: [42, 0.8, 10.1, 0.4, 2.1], max: 6 },
  { n: "Clementine", unit: "clementine", per: [35, 0.6, 8.9, 0.1, 1.3], max: 6 },
  { n: "Grapefruit", unit: "grapefruit", per: [104, 1.9, 26.3, 0.3, 3.7], max: 3 },
  { n: "Avocado", unit: "avocado", per: [240, 3.0, 12.8, 22, 10], max: 3 },
  { n: "Medjool dates", unit: "date", per: [66, 0.4, 18, 0, 1.6], max: 8 },
];
export const fruitStep = (f) => (f.unit === "cup" ? 0.25 : f.unit === "date" ? 1 : 0.5);
export const fruitStart = (f) => (f.unit === "cup" ? 0.5 : 1);

// Macros for qty units of a fruit, rounded the way the log shows them.
export function fruitMacros(f, qty) {
  const q = Math.max(0, +qty || 0), r = (v, d) => +(v * q).toFixed(d);
  return { calories: Math.round(f.per[0] * q), protein: r(f.per[1], 1), carbs: r(f.per[2], 1), fat: r(f.per[3], 1), fiber: r(f.per[4], 1) };
}
