// What is going on inside the body at each fasting hour, in plain language, from standard human physiology
// (for example Cahill's studies of fasting in people, and Ho et al. 1988 on growth hormone). Timing varies a lot
// between people: your last meal, size, sex, sleep and activity all move these numbers. This is not medical advice.
export const STAGE_DETAIL = {
  0: {
    inside: "Food is being digested and blood sugar rises. Your pancreas releases insulin, which tells the liver, muscle and fat to take sugar in. The liver and muscles store it as glycogen, and the extra becomes fat. Insulin also switches off fat release, so you are in storage mode.",
    feel: "Satisfied. A big carb-heavy meal can make you sleepy.",
  },
  4: {
    inside: "Digestion is finishing and insulin is dropping. The pancreas now releases glucagon, which tells the liver to break its glycogen back into sugar. That keeps blood sugar steady, because your brain needs a steady supply (roughly 100 to 120 g of glucose a day).",
    feel: "Normal. Early hunger is mostly your body clock and the hormone ghrelin, which rises at your usual meal times.",
  },
  8: {
    inside: "Liver glycogen is running down. Insulin is now low enough that fat cells release fatty acids into the blood, and muscle and heart start using them. The liver also begins making new glucose (gluconeogenesis) from glycerol (from fat), lactate and amino acids.",
    feel: "Mild hunger waves and maybe some irritability. Both usually pass in 20 to 30 minutes.",
  },
  12: {
    inside: "Fat is now the main fuel for most of your body. The liver turns some fatty acids into ketones, mainly beta-hydroxybutyrate. Blood ketones are still low at this point, usually under 0.5 mmol/L. Blood sugar stays in the normal range because the liver keeps adjusting.",
    feel: "Hunger comes in waves instead of building steadily. Drinking water or tea often helps.",
  },
  16: {
    inside: "Ketones climb, often into the 0.3 to 1.0 mmol/L range, and the brain starts using them for part of its energy. Insulin is near its daily low, so fat release is strong. Some people report clearer focus. That is mostly self-reported and from small studies.",
    feel: "Hunger often flattens out. Some people feel calm and focused. Some feel tired or have a mild headache.",
  },
  18: {
    inside: "Growth hormone is released by the pituitary in pulses, and fasting makes those pulses bigger and more frequent. In one human study, two days without food raised daily growth hormone output about five-fold. Its job during a fast is protective. It helps release fat and keeps blood sugar up while sparing muscle. It is not a muscle-building boost, and the liver's IGF-1 signal actually falls during a fast.",
    feel: "Nothing you can feel. This one is invisible.",
  },
  20: {
    inside: "Low insulin and low amino acids switch on the energy sensor AMPK and turn down mTOR. Together they promote autophagy, where cells break down and recycle worn-out parts. That is well proven in animals and cell studies, and it won the 2016 Nobel Prize. In people it is hard to measure, and nobody knows the exact hour it ramps up.",
    feel: "Nothing you can feel. Don't treat any one hour as a magic cutoff.",
  },
  24: {
    inside: "Liver glycogen is mostly used up. Ketones are the main alternative fuel, often around 0.5 to 1.5 mmol/L. About half of the glucose your brain still needs is made from glycerol and from amino acids, some of which come from muscle. Your kidneys also start losing more sodium, so electrolytes begin to dip.",
    feel: "Lightheadedness when you stand up, feeling cold, headaches, low energy. Salt and water help.",
  },
  30: {
    inside: "Ketones are commonly 1 to 3 mmol/L. Thyroid hormone T3 falls a little and stress hormones rise slightly, which slows your metabolism a bit while keeping blood sugar up. The kidneys keep losing sodium and potassium, which is behind most fasting headaches and cramps.",
    feel: "Hunger may ease but weakness, cramps, headaches and brain fog are common. Stop if you feel unwell.",
  },
  36: {
    inside: "Your body still turns some amino acids into glucose, so lean tissue is being used. Blood pressure runs lower and the heart rate can climb when you stand. Uric acid rises because ketones compete with it for removal, which can set off gout in people prone to it.",
    feel: "Dizziness on standing, palpitations, chills, deep fatigue. These are signs to break the fast.",
  },
  48: {
    inside: "Ketones are often 2 to 5 mmol/L, and the brain gets a large share of its energy from them. That reduces the glucose the body has to make, so muscle breakdown slows. Insulin is at its lowest. Risks grow with length, including low potassium and magnesium (which can disturb heart rhythm), gallstones, and low blood pressure.",
    feel: "Weak, cold, foggy or oddly calm. Many people find it hard to concentrate.",
  },
  72: {
    inside: "Ketones can reach 4 to 7 mmol/L, and the brain gets more than half its energy from them. When insulin returns after eating, phosphate, potassium and magnesium move quickly back into cells. If they run low, that can cause refeeding syndrome with dangerous heart rhythm changes, so people refeed slowly and under medical advice. A mouse study and a small human study suggested immune cells are cleared and rebuilt, but a health benefit is not proven.",
    feel: "Marked weakness and fatigue. This is a doctor-supervised length, and the people at most risk are those with diabetes, heart, kidney or eating-disorder history, or on medicines.",
  },
};
