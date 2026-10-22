// Disconnect: cancel access at the provider (best effort), delete our copy.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ docs: new Map(), uid: "u1" }));
vi.mock("./_lib/secure.js", () => ({
  adminDb: {
    doc: (path) => ({
      async get() { const d = store.docs.get(path); return { exists: !!d, data: () => d }; },
      async delete() { store.docs.delete(path); },
    }),
  },
  verifyAuth: async () => store.uid,
  applyCors: () => false,
  encryptSecret: (s) => s, decryptSecret: (s) => s, openToken: (s) => s || null, isSealed: () => true,
}));

import handler, { revokeAtProvider } from "./connectors.js";

const call = (provider, method = "POST") => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ method, query: { provider, action: "disconnect" }, headers: {} }, res).then(() => res);
};

beforeEach(() => { store.docs.clear(); store.uid = "u1"; vi.unstubAllGlobals(); });

describe("disconnect", () => {
  it("cancels Oura's access and deletes the stored sign-in and data", async () => {
    store.docs.set("users/u1/integrations/oura", { accessToken: "oura-tok", refreshToken: "oura-ref", lastSleepHours: 7 });
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", f);
    const res = await call("oura");
    expect(res.body).toEqual({ ok: true, revoked: true });
    expect(f.mock.calls[0][0]).toBe("https://api.ouraring.com/oauth/revoke?access_token=oura-tok");
    expect(store.docs.has("users/u1/integrations/oura")).toBe(false);
  });

  it("still disconnects if the provider can't be reached", async () => {
    store.docs.set("users/u1/integrations/gmail", { accessToken: "a", refreshToken: "r" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await call("gmail");
    expect(res.body).toEqual({ ok: true, revoked: false });
    expect(store.docs.has("users/u1/integrations/gmail")).toBe(false);
  });

  it("only signed-in users, only POST, only known services", async () => {
    expect((await call("oura", "GET")).statusCode).toBe(405);
    expect((await call("plaid")).statusCode).toBe(400);
    store.uid = null;
    expect((await call("oura")).statusCode).toBe(401);
  });

  it("revokes Google with the refresh token; Outlook has nothing to revoke", async () => {
    const f = vi.fn(async () => ({ ok: true }));
    expect(await revokeAtProvider("google", { accessToken: "a", refreshToken: "r" }, f)).toBe(true);
    expect(f.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/revoke?token=r");
    expect(await revokeAtProvider("outlook", { accessToken: "a" }, f)).toBe(false);
    expect(await revokeAtProvider("oura", {}, f)).toBe(false);
  });
});
