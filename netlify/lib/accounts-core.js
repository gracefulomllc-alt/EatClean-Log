import { keyFor } from "./codekey.js";

// Name + 4-digit code logins. Each account points at a normal sync code, so everything else
// (sync, watch data, photos) works exactly as before. The sync code never leaves the server
// until the right PIN is entered. The first account created is the admin and can reset PINs.
// A PIN has only 10,000 possibilities and the name list is public, so guessing is slowed down:
// after MAX_TRIES wrong tries in a row a name waits WAIT_MS. Normal fumbles never reach it.
export const MAX_TRIES = 10;
export const WAIT_MS = 2 * 60 * 1000;
export const MAX_ACCOUNTS = 200;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const hashPin = async (pin, salt) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cutlog-pin:${salt}:${pin}`)));
const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 24);
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const okPin = (p) => /^\d{4}$/.test(String(p || ""));
const bad = (status, msg) => ({ status, body: { error: msg } });
const pub = (a) => ({ id: a.id, name: a.name, admin: !!a.admin });

export async function handle(store, body, { purge = null, recoveryKey = "", now = Date.now(), newId = () => crypto.randomUUID(), newCode = () => hex(crypto.getRandomValues(new Uint8Array(8))).toUpperCase() } = {}) {
  const roster = JSON.parse((await store.get("roster")) || '{"accounts":[]}');
  const save = () => store.set("roster", JSON.stringify(roster));
  const find = (id) => roster.accounts.find((a) => a.id === id);

  // Checks the PIN and the wait. Returns an error response, or null when the PIN is right.
  const check = async (a, pin) => {
    if (!a) return bad(404, "That name isn't on the list anymore.");
    if (a.until && a.until > now) return bad(429, `Too many wrong codes. Try again in ${Math.ceil((a.until - now) / 60000)} minute(s).`);
    if (!okPin(pin) || (await hashPin(pin, a.salt)) !== a.hash) {
      a.fails = (a.fails || 0) + 1;
      if (a.fails >= MAX_TRIES) { a.until = now + WAIT_MS; a.fails = 0; }
      await save();
      return bad(401, "That code isn't right.");
    }
    if (a.fails || a.until) { a.fails = 0; a.until = 0; await save(); }
    return null;
  };

  if (body.op === "list") {
    const admin = roster.accounts.find((a) => a.admin);
    return { status: 200, body: { names: roster.accounts.map((a) => ({ id: a.id, name: a.name, admin: !!a.admin })).sort((x, y) => x.name.localeCompare(y.name)), admin: admin ? admin.name : null } };
  }

  if (body.op === "create") {
    const name = cleanName(body.name);
    if (name.length < 2) return bad(400, "Type a name with at least 2 letters.");
    if (!okPin(body.pin)) return bad(400, "The code is 4 numbers.");
    if (roster.accounts.some((a) => sameName(a.name, name))) return bad(409, "That name is taken. Pick it from the list, or add your last initial.");
    if (roster.accounts.length >= MAX_ACCOUNTS) return bad(409, "This app is full.");
    let code = newCode();
    if (body.code) { if (!(await keyFor(body.code))) return bad(400, "That sync code isn't valid."); code = String(body.code).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
    const salt = newId();
    const a = { id: newId(), name, salt, hash: await hashPin(body.pin, salt), code, admin: roster.accounts.length === 0, fails: 0, until: 0, at: now };
    roster.accounts.push(a);
    await save();
    return { status: 200, body: { ...pub(a), code } };
  }

  if (body.op === "login") {
    const a = find(body.id), err = await check(a, body.pin);
    return err || { status: 200, body: { ...pub(a), code: a.code } };
  }

  if (body.op === "setpin") {
    const a = find(body.id), err = await check(a, body.pin);
    if (err) return err;
    if (!okPin(body.newPin)) return bad(400, "The new code is 4 numbers.");
    a.salt = newId(); a.hash = await hashPin(body.newPin, a.salt);
    await save();
    return { status: 200, body: { ok: true } };
  }

  if (body.op === "reset") {
    const boss = find(body.adminId), err = await check(boss, body.adminPin);
    if (err) return err;
    if (!boss.admin) return bad(403, "Only the admin can reset a code.");
    const a = find(body.id);
    if (!a) return bad(404, "That name isn't on the list anymore.");
    if (!okPin(body.newPin)) return bad(400, "The new code is 4 numbers.");
    a.salt = newId(); a.hash = await hashPin(body.newPin, a.salt); a.fails = 0; a.until = 0;
    await save();
    return { status: 200, body: { ok: true } };
  }

  // An admin can make someone else an admin (or take it away). There is always at least one admin.
  if (body.op === "setadmin") {
    const boss = find(body.adminId), err = await check(boss, body.adminPin);
    if (err) return err;
    if (!boss.admin) return bad(403, "Only an admin can do that.");
    const a = find(body.id);
    if (!a) return bad(404, "That name isn't on the list anymore.");
    const on = !!body.admin;
    if (!on && roster.accounts.filter((x) => x.admin && x.id !== a.id).length === 0) return bad(400, "There has to be at least one admin.");
    a.admin = on;
    await save();
    return { status: 200, body: { ok: true } };
  }

  // Lost admin (the first profile was a test one nobody can sign into): whoever holds the app owner's ADMIN_KEY setting can claim it with their own name and code.
  if (body.op === "claimadmin") {
    if (!recoveryKey || String(body.key || "") !== recoveryKey) return bad(403, "That owner key isn't right.");
    const a = find(body.id), err = await check(a, body.pin);
    if (err) return err;
    a.admin = true;
    await save();
    return { status: 200, body: { ok: true } };
  }

  // Delete a profile: you can delete your own with your code, and the admin can delete anyone. The person's name has to be typed to confirm.
  // Their cloud log, watch data and photos go too, unless another profile still uses the same sync code.
  if (body.op === "delete") {
    let target;
    if (body.adminId) {
      const boss = find(body.adminId), err = await check(boss, body.adminPin);
      if (err) return err;
      if (!boss.admin) return bad(403, "Only the admin can delete someone else's profile.");
      target = find(body.id);
      if (!target) return bad(404, "That name isn't on the list anymore.");
    } else {
      target = find(body.id);
      const err = await check(target, body.pin);
      if (err) return err;
    }
    if (!body.confirm || !sameName(cleanName(body.confirm), target.name)) return bad(400, "Type the name exactly to confirm.");
    const others = roster.accounts.filter((a) => a.id !== target.id);
    if (target.admin && others.length && !others.some((a) => a.admin)) others.slice().sort((x, y) => (x.at || 0) - (y.at || 0))[0].admin = true;   // the oldest profile takes over as admin
    roster.accounts = others;
    await save();
    if (purge && !others.some((a) => a.code === target.code)) await purge(target.code);
    return { status: 200, body: { ok: true } };
  }

  return bad(400, "Unknown op");
}
