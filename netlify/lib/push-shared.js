import { getStore } from "@netlify/blobs";
import webpush from "web-push";

// Same ladder the app shows. Kept in step by hand - if you change one, change both.
export const STAGES = [
  { at: 0,  name: "Fed", body: "Insulin is up and you're absorbing the meal." },
  { at: 4,  name: "Post-absorptive", body: "Insulin is falling. Your liver is releasing stored glucose to hold blood sugar steady." },
  { at: 8,  name: "Glycogen drawdown", body: "Liver glycogen is running down and fat is starting to cover more of the load." },
  { at: 12, name: "Fat burning", body: "Most of your fuel is now fat. Hunger comes in waves here — it passes." },
  { at: 16, name: "Ketosis building", body: "Ketones are climbing. Appetite usually flattens out and focus often sharpens." },
  { at: 18, name: "Growth hormone rise", body: "Growth hormone trends upward — part of why muscle holds up through a fast." },
  { at: 20, name: "Autophagy window", body: "Cellular cleanup is thought to step up around here, though the human timing is poorly pinned down." },
  { at: 24, name: "Deep fast", body: "Liver glycogen is largely gone and ketones are the main fuel. Mind your electrolytes and don't train hard." },
];
export const stageAt = (h) => STAGES.reduce((a, s) => (h >= s.at ? s : a), STAGES[0]);
export const hoursSince = (t) => (Date.now() - t) / 36e5;

export const pushStore = () => getStore("cutlog-push");

// VAPID keys identify this site to the browsers' push services. Generated once on
// first use and kept in Blobs, so there's nothing to set up by hand.
export async function vapid() {
  const s = pushStore();
  let v = await s.get("vapid", { type: "json" });
  if (!v?.publicKey) {
    v = webpush.generateVAPIDKeys();
    await s.setJSON("vapid", v);
  }
  return v;
}

export async function pusher() {
  const v = await vapid();
  webpush.setVapidDetails(Netlify.env.get("URL") || "https://eatclean247.netlify.app", v.publicKey, v.privateKey);
  return webpush;
}
