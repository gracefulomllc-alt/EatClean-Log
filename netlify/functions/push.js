import { getStore } from "@netlify/blobs";
import { pushStore, vapid, pusher, stageAt, hoursSince } from "../lib/push-shared.js";
import { auth } from "../lib/groups-core.js";
import { markIndex } from "../lib/alerts-core.js";

const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const okId = (id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const store = pushStore();

  if (body.op === "key") return json({ key: (await vapid()).publicKey });

  if (!okId(body.deviceId)) return new Response("Bad device id", { status: 400 });
  const k = "dev:" + body.deviceId;

  if (body.op === "subscribe") {
    if (!body.sub?.endpoint) return new Response("Bad subscription", { status: 400 });
    const start = body.start || null;
    // Mark the stage you're already in as announced, so switching alerts on mid-fast
    // doesn't fire off every stage you've already passed.
    // Re-subscribing (new browser token, reinstall) keeps the alert choices already made.
    const prev = (await store.get(k, { type: "json" })) || {};
    await store.setJSON(k, { ...prev, sub: body.sub, start, lastAt: start ? stageAt(hoursSince(start)).at : -1, fcMark: start ? markIndex(hoursSince(start)) : -1 });
    return json({ ok: true });
  }

  if (body.op === "fast") {
    const rec = await store.get(k, { type: "json" });
    if (!rec) return json({ ok: false, reason: "not subscribed" });
    const start = body.start || null;
    if (rec.start !== start) {
      rec.start = start;
      rec.lastAt = start ? stageAt(hoursSince(start)).at : -1;
      rec.fcMark = start ? markIndex(hoursSince(start)) : -1;   // switching alerts on mid-fast shouldn't replay old marks
      await store.setJSON(k, rec);
    }
    return json({ ok: true });
  }

  if (body.op === "reminders") {
    const rec = await store.get(k, { type: "json" });
    if (!rec) return new Response("Turn fasting alerts on first", { status: 404 });
    const times = (Array.isArray(body.times) ? body.times : []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6);
    try { new Intl.DateTimeFormat("en-US", { timeZone: body.tz }); } catch { return new Response("Unknown time zone", { status: 400 }); }
    rec.reminders = { times, tz: body.tz };
    await store.setJSON(k, rec);
    return json({ ok: true, times });
  }

  // Which alerts this device wants. Group links are checked against the group's own login so a
  // device can only ever get nudges meant for a member it actually is.
  if (body.op === "alerts") {
    const rec = await store.get(k, { type: "json" });
    if (!rec) return new Response("Turn alerts on first", { status: 404 });
    const a = body.alerts || {};
    const team = typeof a.team === "string" && /^[A-Za-z0-9 .'-]{2,24}$/.test(a.team) ? a.team : null;
    rec.alerts = { team, spc: !!a.spc, fastCheck: !!a.fastCheck, nudges: !!a.nudges, water: !!a.water, review: !!a.review };
    if (body.tz) {
      try { new Intl.DateTimeFormat("en-US", { timeZone: body.tz }); rec.tz = body.tz; } catch { return new Response("Unknown time zone", { status: 400 }); }
    }
    const groups = getStore("cutlog-groups");
    const links = [];
    for (const l of (Array.isArray(body.links) ? body.links : []).slice(0, 5)) {
      const g = await auth(groups, l);
      if (g) links.push({ gid: g.id, mid: l.memberId });
    }
    rec.links = links;
    rec.nseen = Object.fromEntries(links.map((l) => [l.gid, rec.nseen?.[l.gid] ?? Date.now()]));
    await store.setJSON(k, rec);
    return json({ ok: true, links: links.length });
  }

  if (body.op === "logged") {
    const rec = await store.get(k, { type: "json" });
    if (!rec) return json({ ok: false });
    const at = +body.at;
    // Accept anything within a day of now. Phone clocks drift and meal times get edited
    // forward; rejecting those would make reminders nag someone who already logged.
    if (at > (rec.lastLog || 0) && Math.abs(at - Date.now()) < 864e5) { rec.lastLog = at; await store.setJSON(k, rec); }
    return json({ ok: true });
  }

  if (body.op === "unsubscribe") {
    await store.delete(k);
    return json({ ok: true });
  }

  if (body.op === "test") {
    const rec = await store.get(k, { type: "json" });
    if (!rec?.sub) return new Response("This device isn't subscribed. Turn alerts on first.", { status: 404 });
    try {
      const wp = await pusher();
      await wp.sendNotification(rec.sub, JSON.stringify({
        title: "Cut Log alerts are working",
        body: "You'll get one of these each time a fast reaches a new stage.",
      }));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await store.delete(k);
      return new Response(`Push service refused it (${e.statusCode || "no status"}). Turn alerts off and on again.`, { status: 502 });
    }
    return json({ ok: true });
  }

  return new Response("Unknown op", { status: 400 });
};

export const config = { path: "/api/push" };
