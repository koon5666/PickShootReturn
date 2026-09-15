// Cookie-carrying fetch for test scripts against a LOCAL server (P0-2: every
// /api route needs the psr_session cookie). Node's fetch keeps no cookie jar,
// so this tiny client stores the Set-Cookie from /api/login and replays it.
//
//   import { apiClient } from "./apiclient.mjs";
//   const admin = await apiClient(base).loginAdmin("9999");      // owner
//   const nong  = await apiClient(base).loginEmployee("e_nong", "1111");
//   await admin.get("/api/data");  await admin.put("/api/data", {...});  await admin.post("/api/tombstone", {...});
export function apiClient(base) {
  let cookie = "";
  const hdr = (extra = {}) => ({ ...(cookie ? { Cookie: cookie } : {}), ...extra });
  const remember = (r) => {
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return r;
  };
  const c = {
    get cookie() { return cookie; },
    raw: (path, init = {}) => fetch(base + path, { ...init, headers: hdr(init.headers || {}) }).then(remember),
    get: (path) => c.raw(path).then(r => r.json()),
    getStatus: (path) => c.raw(path).then(r => r.status),
    put: (path, body) => c.raw(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    post: (path, body) => c.raw(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }),
    del: (path) => c.raw(path, { method: "DELETE" }),
    async login(body) {
      const r = await c.post("/api/login", body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`login ${JSON.stringify(body)} -> ${r.status} ${j.error || ""}`);
      c.user = j.user;
      return c;
    },
    loginAdmin: (pin, staffId) => c.login({ role: "admin", pin, ...(staffId ? { staffId } : {}) }),
    loginEmployee: (empId, pin) => c.login({ role: "employee", empId, pin }),
    logout: () => c.post("/api/logout").then(() => { cookie = ""; return c; }),
  };
  return c;
}
