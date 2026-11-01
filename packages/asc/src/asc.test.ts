import { Effect } from "effect";
import { exportPKCS8, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  AscClient,
  type AscRequest,
  MAX_TTL_SECONDS,
  parseCredentials,
  parseRateLimit,
  signToken,
  verifyCredentials,
} from "./index";

const ISSUER = "57246542-96fe-1a63-e053-0824d011072a";
const KEY_ID = "2X9R4HXF34";

const keyPair = async (namedCurve = "P-256") => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve }, true, ["sign", "verify"]);
  return { pem: await exportPKCS8(pair.privateKey), publicKey: pair.publicKey };
};

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

const teamCreds = async () => {
  const { pem, publicKey } = await keyPair();
  const creds = await run(parseCredentials({ kind: "team", issuerId: ISSUER, keyId: KEY_ID, privateKey: pem }));
  return { creds, publicKey };
};

describe("parseCredentials", () => {
  it("accepts a pasted .p8 with surrounding whitespace and CRLF line endings", async () => {
    const { pem } = await keyPair();
    const creds = await run(
      parseCredentials({
        kind: "team",
        issuerId: ` ${ISSUER} `,
        keyId: ` ${KEY_ID}\n`,
        privateKey: `\n  ${pem.replaceAll("\n", "\r\n")}  \n`,
      }),
    );
    expect(creds).toEqual({ kind: "team", issuerId: ISSUER, keyId: KEY_ID, privateKeyPem: pem.trim() });
  });

  it("accepts an individual key without an issuer", async () => {
    const { pem } = await keyPair();
    const creds = await run(parseCredentials({ kind: "individual", keyId: KEY_ID, privateKey: pem }));
    expect(creds.kind).toBe("individual");
  });

  it.each([
    ["keyId", { keyId: "short" }],
    ["keyId", { keyId: "2x9r4hxf34" }],
    ["issuerId", { issuerId: "not-a-uuid" }],
    ["issuerId", { issuerId: undefined }],
    ["kind", { kind: "admin" }],
    ["privateKey", { privateKey: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" }],
  ])("rejects a bad %s", async (field, override) => {
    const { pem } = await keyPair();
    const raw = { kind: "team", issuerId: ISSUER, keyId: KEY_ID, privateKey: pem, ...override };
    expect(await failure(parseCredentials(raw))).toMatchObject({ _tag: "InvalidCredentials", field });
  });

  it("rejects a P-384 key", async () => {
    const { pem } = await keyPair("P-384");
    const error = await failure(parseCredentials({ kind: "team", issuerId: ISSUER, keyId: KEY_ID, privateKey: pem }));
    expect(error).toMatchObject({ field: "privateKey" });
  });
});

describe("signToken", () => {
  it("signs a team token Apple's way, with scope", async () => {
    const { creds, publicKey } = await teamCreds();
    const scope = ["GET /v1/apps?filter[platform]=IOS"];
    const token = await run(signToken(creds, { scope }));
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, { audience: "appstoreconnect-v1" });

    expect(protectedHeader).toEqual({ alg: "ES256", kid: KEY_ID, typ: "JWT" });
    expect(payload).toEqual({ iss: ISSUER, iat: expect.any(Number), exp: expect.any(Number), aud: "appstoreconnect-v1", scope });
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
    expect(Math.abs(payload.iat! - Date.now() / 1000)).toBeLessThan(5);
  });

  it("signs an individual token with sub=user and no iss", async () => {
    const { pem, publicKey } = await keyPair();
    const creds = await run(parseCredentials({ kind: "individual", keyId: KEY_ID, privateKey: pem }));
    const { payload, protectedHeader } = await jwtVerify(await run(signToken(creds)), publicKey);

    expect(protectedHeader.kid).toBe(KEY_ID);
    expect(payload).toEqual({ sub: "user", iat: expect.any(Number), exp: expect.any(Number), aud: "appstoreconnect-v1" });
  });

  it("clamps the lifetime to 20 minutes", async () => {
    const { creds, publicKey } = await teamCreds();
    const { payload } = await jwtVerify(await run(signToken(creds, { ttlSeconds: 3600 })), publicKey);
    expect(payload.exp! - payload.iat!).toBe(MAX_TTL_SECONDS);
    expect(MAX_TTL_SECONDS).toBe(1200);
  });
});

describe("parseRateLimit", () => {
  it("reads limit and remaining", () => {
    expect(parseRateLimit("user-hour-lim:3500;user-hour-rem:500;")).toEqual({ limit: 3500, remaining: 500 });
  });
  it.each([null, "", "user-hour-lim:3500;", "garbage"])("returns undefined for %j", (header) => {
    expect(parseRateLimit(header)).toBeUndefined();
  });
});

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const fakeAsc = (replies: ReadonlyArray<Reply>) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const reply = replies[Math.min(calls.length, replies.length) - 1]!;
    const body = reply.body instanceof Uint8Array ? reply.body : JSON.stringify(reply.body);
    return new Response(body, {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof globalThis.fetch;
  const call = <A, E>(f: (client: AscClient["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.flip(AscClient.use(f)).pipe(Effect.provide(AscClient.layerWith({ fetch, retryBaseDelay: "1 millis" }))),
    );
  const ok = <A, E>(f: (client: AscClient["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(AscClient.use(f).pipe(Effect.provide(AscClient.layerWith({ fetch, retryBaseDelay: "1 millis" }))));
  return { calls, call, ok, fetch };
};

const listApps: AscRequest = { method: "GET", path: "/v1/apps", query: { limit: 1, "fields[apps]": ["name", "bundleId"] } };
const appleError = (status: number, code: string) => ({
  errors: [{ status: String(status), code, title: "title", detail: `detail ${code}` }],
});

describe("AscClient", () => {
  it("sends a bearer token and returns JSON with the rate limit", async () => {
    const { creds, publicKey } = await teamCreds();
    const asc = fakeAsc([{ status: 200, body: { data: [] }, headers: { "x-rate-limit": "user-hour-lim:3600;user-hour-rem:3599;" } }]);
    const response = await asc.ok((c) => c.request(creds, listApps));

    expect(response).toEqual({ status: 200, rateLimit: { limit: 3600, remaining: 3599 }, body: { kind: "json", value: { data: [] } } });
    const url = new URL(asc.calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.appstoreconnect.apple.com/v1/apps");
    expect(url.searchParams.get("fields[apps]")).toBe("name,bundleId");
    const auth = new Headers(asc.calls[0]!.init?.headers).get("authorization")!;
    await expect(jwtVerify(auth.replace("Bearer ", ""), publicKey)).resolves.toBeDefined();
  });

  it("reuses one token across requests for the same key", async () => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([{ status: 200, body: {} }]);
    await asc.ok((c) => Effect.andThen(c.request(creds, listApps), c.request(creds, listApps)));
    const [a, b] = asc.calls.map((call) => new Headers(call.init?.headers).get("authorization"));
    expect(a).toBe(b);
  });

  it("does not share a cached token between different keys with the same key ID", async () => {
    const first = await teamCreds();
    const second = await teamCreds();
    const asc = fakeAsc([{ status: 200, body: {} }]);
    await asc.ok((c) => Effect.andThen(c.request(first.creds, listApps), c.request(second.creds, listApps)));
    const token = new Headers(asc.calls[1]!.init?.headers).get("authorization")!.replace("Bearer ", "");
    await expect(jwtVerify(token, second.publicKey)).resolves.toBeDefined();
  });

  it("retries a 429 and then succeeds", async () => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([{ status: 429, body: appleError(429, "RATE_LIMIT_EXCEEDED") }, { status: 200, body: { data: [] } }]);
    const response = await asc.ok((c) => c.request(creds, listApps));
    expect(response.status).toBe(200);
    expect(asc.calls).toHaveLength(2);
  });

  it("gives up after two retries and reports the rate limit", async () => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([{ status: 429, body: appleError(429, "RATE_LIMIT_EXCEEDED"), headers: { "retry-after": "30" } }]);
    expect(await asc.call((c) => c.request(creds, listApps))).toMatchObject({ _tag: "AscRateLimited", retryAfterSeconds: 30 });
    expect(asc.calls).toHaveLength(3);
  });

  it("retries a 5xx on GET but not on POST", async () => {
    const { creds } = await teamCreds();
    const get = fakeAsc([{ status: 503, body: appleError(503, "UNAVAILABLE") }]);
    expect(await get.call((c) => c.request(creds, listApps))).toMatchObject({ _tag: "AscApiError", status: 503 });
    expect(get.calls).toHaveLength(3);

    const post = fakeAsc([{ status: 500, body: appleError(500, "UNEXPECTED_ERROR") }]);
    await post.call((c) => c.request(creds, { method: "POST", path: "/v1/betaGroups", body: { data: {} } }));
    expect(post.calls).toHaveLength(1);
    expect(post.calls[0]!.init?.body).toBe(JSON.stringify({ data: {} }));
  });

  it("does not retry a 404 and maps Apple's error body", async () => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([{ status: 404, body: appleError(404, "NOT_FOUND") }]);
    const error = await asc.call((c) => c.request(creds, { method: "GET", path: "/v1/apps/123" }));
    expect(error).toMatchObject({
      _tag: "AscApiError",
      status: 404,
      errors: [{ status: "404", code: "NOT_FOUND", title: "title", detail: "detail NOT_FOUND" }],
    });
    expect(asc.calls).toHaveLength(1);
  });

  it("maps a thrown fetch to AscNetworkError", async () => {
    const { creds } = await teamCreds();
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const error = await Effect.runPromise(
      Effect.flip(AscClient.use((c) => c.request(creds, listApps))).pipe(Effect.provide(AscClient.layerWith({ fetch }))),
    );
    expect(error._tag).toBe("AscNetworkError");
  });

  it("returns gzip reports as bytes", async () => {
    const { creds } = await teamCreds();
    const gz = new Uint8Array([0x1f, 0x8b, 8, 0]);
    const asc = fakeAsc([{ status: 200, body: gz, headers: { "content-type": "application/a-gzip" } }]);
    const response = await asc.ok((c) => c.request(creds, { method: "GET", path: "/v1/salesReports" }));
    expect(response.body).toEqual({ kind: "bytes", contentType: "application/a-gzip", value: gz });
  });

  it("follows links.next on the ASC host", async () => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([{ status: 200, body: {} }]);
    const next = "https://api.appstoreconnect.apple.com/v1/apps?cursor=AQ.abc&limit=1";
    await asc.ok((c) => c.request(creds, { method: "GET", path: next }));
    expect(asc.calls[0]!.url).toBe(next);
  });

  it("signs a fresh token scoped to exactly the request when scoped is set", async () => {
    const { creds, publicKey } = await teamCreds();
    const asc = fakeAsc([{ status: 200, body: {} }]);
    await asc.ok((c) =>
      Effect.andThen(
        c.request(creds, { method: "GET", path: "/v1/apps", query: { "filter[platform]": "IOS", limit: 5, sort: "name" }, scoped: true }),
        c.request(creds, { method: "GET", path: "https://api.appstoreconnect.apple.com/v1/builds/1?cursor=AQ&include=app", scoped: true }),
      ),
    );
    const scopes = await Promise.all(
      asc.calls.map(async (call) => {
        const token = new Headers(call.init?.headers).get("authorization")!.replace("Bearer ", "");
        return (await jwtVerify(token, publicKey)).payload.scope;
      }),
    );
    expect(scopes).toEqual([["GET /v1/apps?filter[platform]=IOS"], ["GET /v1/builds/1?include=app"]]);
  });

  it.each([
    "https://evil.example.com/v1/apps",
    "//evil.example.com/v1/apps",
    "/\\evil.example.com/v1/apps",
    "http://api.appstoreconnect.apple.com/v1/apps",
    "https://api.appstoreconnect.apple.com.evil.example.com/v1/apps",
    "/v1/../internal",
    "/apps",
    "v1/apps",
  ])("rejects %s without calling fetch", async (path) => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([{ status: 200, body: {} }]);
    expect(await asc.call((c) => c.request(creds, { method: "GET", path }))).toMatchObject({ _tag: "AscInvalidPath" });
    expect(asc.calls).toHaveLength(0);
  });
});

describe("verifyCredentials", () => {
  const verify = async (reply: Reply) => {
    const { creds } = await teamCreds();
    const asc = fakeAsc([reply]);
    const result = await Effect.runPromise(
      verifyCredentials(creds).pipe(Effect.provide(AscClient.layerWith({ fetch: asc.fetch, retryBaseDelay: "1 millis" }))),
    );
    return { result, calls: asc.calls };
  };

  it("passes on 200 and calls GET /v1/apps?limit=1", async () => {
    const { result, calls } = await verify({ status: 200, body: { data: [] } });
    expect(result).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://api.appstoreconnect.apple.com/v1/apps?limit=1");
  });

  it("maps 401 to invalid_key", async () => {
    const { result } = await verify({ status: 401, body: appleError(401, "NOT_AUTHORIZED") });
    expect(result).toMatchObject({ ok: false, reason: "invalid_key" });
  });

  it("maps 403 to forbidden and says the key itself is valid", async () => {
    const { result } = await verify({ status: 403, body: appleError(403, "FORBIDDEN_ERROR") });
    expect(result).toMatchObject({ ok: false, reason: "forbidden", detail: expect.stringContaining("valid") });
  });
});
