import { handle, hashPin, MAX_TRIES, WAIT_MS } from "../netlify/lib/accounts-core.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), raw: m }; };
const store = mem(); let now = 1e12, n = 0;
const opt = () => ({ now, newId: () => "id" + n++, newCode: () => "ABCD1234ABCD1234" });
const H = (b) => handle(store, b, opt());

let r = await H({ op: "list" }); t(r.body.names.length === 0 && r.body.admin === null, "starts empty");
r = await H({ op: "create", name: "Terel", pin: "1234" });
t(r.status === 200 && r.body.admin === true && r.body.code === "ABCD1234ABCD1234", "first account is admin and gets a sync code");
const terel = r.body;
r = await H({ op: "create", name: "  jess  ", pin: "0007" }); t(r.status === 200 && r.body.name === "jess" && r.body.admin === false, "second account is not admin, name trimmed");
const jess = r.body;
t((await H({ op: "create", name: "TEREL", pin: "1111" })).status === 409, "duplicate name (any case) refused");
t((await H({ op: "create", name: "X", pin: "1111" })).status === 400, "short name refused");
t((await H({ op: "create", name: "Sam", pin: "12" })).status === 400 && (await H({ op: "create", name: "Sam", pin: "12ab" })).status === 400, "PIN must be 4 digits");
r = await H({ op: "list" }); t(r.body.names.map((x) => x.name).join() === "jess,Terel" && r.body.admin === "Terel", "list is names only, with the admin");
t(!JSON.stringify(r.body).includes("ABCD") && !JSON.stringify(r.body).includes("hash"), "list leaks no codes or hashes");
t(!store.raw.get("roster").includes('"pin"') && !store.raw.get("roster").includes(":0007\""), "PIN never stored in the clear");
r = await H({ op: "login", id: terel.id, pin: "1234" }); t(r.status === 200 && r.body.code === "ABCD1234ABCD1234", "right PIN returns the sync code");
r = await H({ op: "login", id: terel.id, pin: "9999" }); t(r.status === 401 && !JSON.stringify(r.body).includes("ABCD"), "wrong PIN gives nothing");
t((await H({ op: "login", id: "nope", pin: "1234" })).status === 404, "unknown account");
// adopting an existing sync code
r = await H({ op: "create", name: "Old User", pin: "4321", code: "wxyz-5678-wxyz-5678" }); t(r.status === 200 && r.body.code === "WXYZ5678WXYZ5678", "existing sync code can be linked");
t((await H({ op: "create", name: "Bad Code", pin: "4321", code: "short" })).status === 400, "bad sync code refused");
// change own PIN
t((await H({ op: "setpin", id: jess.id, pin: "1111", newPin: "5555" })).status === 401, "change needs the old PIN");
t((await H({ op: "setpin", id: jess.id, pin: "0007", newPin: "5555" })).status === 200, "change PIN");
t((await H({ op: "login", id: jess.id, pin: "0007" })).status === 401 && (await H({ op: "login", id: jess.id, pin: "5555" })).status === 200, "old PIN dead, new works");
// admin reset
t((await H({ op: "reset", adminId: jess.id, adminPin: "5555", id: terel.id, newPin: "0000" })).status === 403, "non-admin can't reset");
t((await H({ op: "reset", adminId: terel.id, adminPin: "wrong", id: jess.id, newPin: "0000" })).status === 401, "admin must prove their own PIN");
t((await H({ op: "reset", adminId: terel.id, adminPin: "1234", id: jess.id, newPin: "2468" })).status === 200 && (await H({ op: "login", id: jess.id, pin: "2468" })).status === 200, "admin reset works");
// slow guessing
for (let i = 0; i < MAX_TRIES; i++) await H({ op: "login", id: jess.id, pin: "0001" });
r = await H({ op: "login", id: jess.id, pin: "2468" }); t(r.status === 429, "after too many wrong tries, even the right PIN waits");
now += WAIT_MS + 1000;
t((await H({ op: "login", id: jess.id, pin: "2468" })).status === 200, "works again after the wait");
for (let i = 0; i < MAX_TRIES - 1; i++) await H({ op: "login", id: jess.id, pin: "0001" });
await H({ op: "login", id: jess.id, pin: "2468" });
for (let i = 0; i < MAX_TRIES - 1; i++) await H({ op: "login", id: jess.id, pin: "0001" });
t((await H({ op: "login", id: jess.id, pin: "2468" })).status === 200, "a right PIN resets the count");
t(await hashPin("1234", "a") !== await hashPin("1234", "b"), "salted");
// deleting profiles
const purged = [];
const D = (b) => handle(store, b, { ...opt(), purge: async (c) => void purged.push(c) });
const sam = (await H({ op: "create", name: "Sam", pin: "1357", code: "SAMSAMSAMSAM1234" })).body;
t((await D({ op: "delete", id: sam.id, pin: "1357", confirm: "Dan" })).status === 400, "must type the name to confirm");
t((await D({ op: "delete", id: sam.id, pin: "0000", confirm: "Sam" })).status === 401, "own delete needs the right code");
t((await D({ op: "delete", adminId: jess.id, adminPin: "2468", id: sam.id, confirm: "Sam" })).status === 403, "non-admin can't delete others");
r = await D({ op: "delete", id: sam.id, pin: "1357", confirm: "sam" });
t(r.status === 200 && purged.length === 1 && purged[0] === "SAMSAMSAMSAM1234", "own profile deleted and cloud data purged: " + purged);
t((await H({ op: "list" })).body.names.every((x) => x.name !== "Sam"), "gone from the list");
// shared sync code: another profile still uses it, so nothing is purged
const a1 = (await H({ op: "create", name: "Pat", pin: "1111", code: "SHAREDCODE123456" })).body;
const a2 = (await H({ op: "create", name: "Patty", pin: "2222", code: "SHAREDCODE123456" })).body;
purged.length = 0;
await D({ op: "delete", id: a1.id, pin: "1111", confirm: "Pat" });
t(purged.length === 0, "cloud data kept while another profile shares the code");
await D({ op: "delete", id: a2.id, pin: "2222", confirm: "Patty" });
t(purged.length === 1 && purged[0] === "SHAREDCODE123456", "purged when the last one goes");
// admin deletes someone, and admin handover
const old = (await H({ op: "create", name: "Old Test", pin: "9999" })).body;
t((await D({ op: "delete", adminId: terel.id, adminPin: "wrong", id: old.id, confirm: "Old Test" })).status === 401, "admin must prove their code");
t((await D({ op: "delete", adminId: terel.id, adminPin: "1234", id: old.id, confirm: "Old Test" })).status === 200, "admin deletes someone");
r = await D({ op: "delete", id: terel.id, pin: "1234", confirm: "Terel" });
t(r.status === 200, "admin can delete themselves");
r = await H({ op: "list" }); t(r.body.admin !== null && r.body.admin !== "Terel", "someone else is made admin: " + r.body.admin);
console.log(bad ? `${bad} failed` : `accounts ok (${ok})`); process.exit(bad ? 1 : 0);
