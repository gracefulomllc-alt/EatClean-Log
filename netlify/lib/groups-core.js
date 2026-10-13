// Invite-only groups. Everything here takes a `store` (get/setJSON/delete/list) so it can be tested
// without Netlify. Privacy rule: the server only ever stores what each phone chose to publish, and
// it re-filters that to a fixed whitelist, so a client can't push anything else into a group.
export const MIN_MEMBERS = 3;            // a group is "ready" at 3; creating alone is allowed, it just waits
export const MAX_MEMBERS = 20;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_STATUS_BYTES = 6000;
const NUDGE_KINDS = new Set(["check", "cheer"]);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const newCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
};
export const normCode = (s) => {
  const c = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 12 ? c : null;
};
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const cleanName = (s, max = 24) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const err = (status, msg) => ({ status, error: msg });
const ok = (o = {}) => ({ status: 200, ...o });

// What a member is allowed to publish. Habits are yes/no only: never points, never rank.
const HABITS = ["meals", "cal", "protein", "veg", "move", "water", "checkin"];
const num = (x, lo, hi) => (Number.isFinite(+x) && +x >= lo && +x <= hi ? Math.round(+x * 10) / 10 : null);
export function cleanStatus(s) {
  const out = { scopes: {}, at: 0 };
  const sc = s?.scopes || {};
  for (const k of ["fast", "weight", "cal", "habits"]) out.scopes[k] = !!sc[k];
  if (out.scopes.fast && s.fast && Number.isFinite(+s.fast.start)) {
    out.fast = { start: +s.fast.start };
    if (Number.isFinite(+s.fast.confirmedAt)) out.fast.confirmedAt = +s.fast.confirmedAt;
  }
  if (out.scopes.weight && s.weight) {
    out.weight = { start: num(s.weight.start, 50, 900), current: num(s.weight.current, 50, 900), goal: num(s.weight.goal, 50, 900) };
  }
  if (out.scopes.cal && s.cal) {
    out.cal = { eaten: num(s.cal.eaten, 0, 20000), target: num(s.cal.target, 0, 20000), protein: num(s.cal.protein, 0, 1000), proteinTarget: num(s.cal.proteinTarget, 0, 1000) };
  }
  if (out.scopes.habits && s.habits) {
    out.habits = {};
    for (const k of HABITS) out.habits[k] = !!s.habits[k];
    if (Array.isArray(s.week)) out.week = s.week.slice(0, 7).map((x) => (x === true ? true : x === false ? false : null));
  }
  return out;
}

async function loadGroup(store, gid) {
  if (!/^[0-9a-f-]{36}$/i.test(String(gid || ""))) return null;
  return store.get("g:" + gid, { type: "json" });
}
export async function auth(store, body) {
  const g = await loadGroup(store, body.groupId);
  const m = g?.members?.[body.memberId];
  if (!g || !m || !body.token || (await sha("tok:" + body.token)) !== m.th) return null;
  return g;
}

export async function handle(store, body, ctx = {}) {
  const now = ctx.now || Date.now();
  const limit = ctx.limit || (async () => true);       // (key, max) => allowed?
  const op = body?.op;

  if (op === "ping") return ok();

  if (op === "create") {
    if (!(await limit("create", 10))) return err(429, "Too many groups created from here. Try again later.");
    const name = cleanName(body.name, 32), me = cleanName(body.member);
    if (!name || !me) return err(400, "Give the group and yourself a name.");
    const gid = crypto.randomUUID(), mid = crypto.randomUUID(), token = newToken(), code = newCode();
    const g = { id: gid, name, created: now, creator: mid, locked: false, inv: await sha("inv:" + code),
      members: { [mid]: { name: me, th: await sha("tok:" + token), joined: now } } };
    await store.setJSON("g:" + gid, g);
    await store.setJSON("inv:" + g.inv, { gid });
    return ok({ groupId: gid, groupName: name, memberId: mid, token, code });
  }

  if (op === "join") {
    if (!(await limit("join", 25))) return err(429, "Too many tries. Wait a bit.");
    const code = normCode(body.code), me = cleanName(body.member);
    if (!code) return err(400, "Invite codes are 12 letters and numbers.");
    if (!me) return err(400, "Add your name first.");
    const idx = await store.get("inv:" + (await sha("inv:" + code)), { type: "json" });
    const g = idx && (await loadGroup(store, idx.gid));
    if (!g || g.inv !== (await sha("inv:" + code))) return err(404, "That code doesn't match a group.");
    if (g.locked) return err(403, "This group isn't taking new members.");
    if (Object.keys(g.members).length >= MAX_MEMBERS) return err(409, `This group is full (${MAX_MEMBERS} people).`);
    const mid = crypto.randomUUID(), token = newToken();
    g.members[mid] = { name: me, th: await sha("tok:" + token), joined: now };
    await store.setJSON("g:" + g.id, g);
    return ok({ groupId: g.id, groupName: g.name, memberId: mid, token, count: Object.keys(g.members).length });
  }

  const g = await auth(store, body || {});
  if (!g) return err(401, "You're not in this group anymore.");
  const me = body.memberId;
  const isCreator = g.creator === me;

  if (op === "publish") {
    const clean = cleanStatus(body.status);
    clean.at = now;
    const raw = JSON.stringify(clean);
    if (raw.length > MAX_STATUS_BYTES) return err(413, "Status too large.");
    await store.setJSON(`s:${g.id}:${me}`, clean);
    return ok();
  }

  if (op === "board") {
    const members = [];
    for (const [id, m] of Object.entries(g.members)) {
      const status = await store.get(`s:${g.id}:${id}`, { type: "json" });
      members.push({ id, name: m.name, isMe: id === me, creator: id === g.creator, joined: m.joined, status: status || null });
    }
    members.sort((a, b) => a.joined - b.joined);
    const nudges = (await store.get(`n:${g.id}:${me}`, { type: "json" })) || [];
    return ok({ group: { id: g.id, name: g.name, locked: !!g.locked, count: members.length, ready: members.length >= MIN_MEMBERS, isCreator }, members, nudges });
  }

  if (op === "nudge") {
    const to = String(body.to || "");
    if (!g.members[to] || to === me) return err(400, "Pick someone else in the group.");
    if (!NUDGE_KINDS.has(body.kind)) return err(400, "Unknown nudge.");
    if (!(await limit(`nudge:${me}:${to}`, 1))) return err(429, "You already nudged them this hour.");
    const key = `n:${g.id}:${to}`;
    const list = (await store.get(key, { type: "json" })) || [];
    list.push({ from: g.members[me].name, kind: body.kind, at: now });
    await store.setJSON(key, list.slice(-20));
    return ok();
  }

  if (op === "ack") {
    const key = `n:${g.id}:${me}`;
    const list = ((await store.get(key, { type: "json" })) || []).filter((n) => n.at > (+body.upTo || 0));
    await store.setJSON(key, list);
    return ok();
  }

  if (op === "leave" || op === "remove") {
    const target = op === "leave" ? me : String(body.target || "");
    if (op === "remove" && !isCreator) return err(403, "Only the group creator can remove people.");
    if (!g.members[target]) return err(404, "Not in the group.");
    delete g.members[target];
    await store.delete(`s:${g.id}:${target}`);
    await store.delete(`n:${g.id}:${target}`);
    const ids = Object.keys(g.members);
    if (!ids.length) {
      await store.delete("inv:" + g.inv); await store.delete("g:" + g.id);
      return ok({ deleted: true });
    }
    if (g.creator === target) g.creator = ids.sort((a, b) => g.members[a].joined - g.members[b].joined)[0];
    await store.setJSON("g:" + g.id, g);
    return ok();
  }

  if (op === "lock") {
    if (!isCreator) return err(403, "Only the group creator can do that.");
    g.locked = !!body.locked;
    await store.setJSON("g:" + g.id, g);
    return ok({ locked: g.locked });
  }

  if (op === "reset") {
    if (!isCreator) return err(403, "Only the group creator can do that.");
    const code = newCode();
    await store.delete("inv:" + g.inv);
    g.inv = await sha("inv:" + code);
    await store.setJSON("inv:" + g.inv, { gid: g.id });
    await store.setJSON("g:" + g.id, g);
    return ok({ code });
  }

  return err(400, "Unknown op");
}
