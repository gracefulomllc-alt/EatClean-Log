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
console.log(bad ? `${bad} failed` : `accounts ok (${ok})`); process.exit(bad ? 1 : 0);
