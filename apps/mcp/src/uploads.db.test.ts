import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { parseCredentials } from "@asc-mcp/asc";
import { Crypto } from "@asc-mcp/crypto";
import { type ConnectionId, type OrgClaims, type OrgId, type UserId, connectionSecretAad, deleteConnection, insertConnection, newConnectionId } from "@asc-mcp/db";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { operations } from "./operations";
import { callerFor, rpc, testApp } from "./testing";

const suffix = Math.random().toString(36).slice(2, 10);
const orgId = `org_upload_${suffix}` as OrgId;
const admin: OrgClaims = { kind: "org", sub: `user_upload_${suffix}` as UserId, orgId, orgRole: "org:admin" };
const file = Buffer.from("abcdefgh");
let app: Awaited<ReturnType<typeof testApp>>;
let connectionId: ConnectionId;
let server: Server;
let storageFails = false;
let reservationFails = false;
let pending = false;
let wrongApp = false;
let reused = false;
let foreignImage = false;
const calls: { method: string; path: string; authorization: string; body: Buffer; accept: string }[] = [];
const image = (state: string) => ({ data: { type: "appAssetLibraryImages", id: "image-a", attributes: { state } } });

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const path = new URL(request.url!, "http://fixture").pathname;
    const method = request.method!;
    calls.push({ method, path, authorization: request.headers.authorization ?? "", body, accept: request.headers.accept ?? "" });
    let result: unknown = { data: { id: "ok", attributes: { method, path, body: body.length && path !== "/storage" ? JSON.parse(body.toString()) : null } } };
    response.setHeader("content-type", "application/json");
    if (path === "/storage") {
      response.statusCode = storageFails ? 500 : 204;
      response.end(); return;
    }
    if (path === "/v1/appStoreVersionLocalizations/locale-a") result = { data: { relationships: { appStoreVersion: { data: { id: "version-a" } } } } };
    else if (path === "/v1/appStoreVersions/version-a") result = { data: { relationships: { app: { data: { id: wrongApp ? "another-app" : "app-a" } } } } };
    else if (path === "/v1/apps/app-a/assetLibrary") result = { data: { id: "library-a" } };
    else if (path === "/v1/appAssetLibraries/library-a/images") result = { data: foreignImage ? [] : [{ id: "image-a" }] };
    else if (path === "/v1/appAssetLibraryImages" && method === "POST") {
      if (reservationFails) { response.statusCode = 403; result = { errors: [{ status: "403", code: "FORBIDDEN", title: "No access", detail: "The key cannot manage assets." }] }; }
      else result = { data: { id: "image-a", attributes: { fileSize: file.length, state: "AWAITING_UPLOAD", uploadOperations: [
        { method: "PUT", url: "https://store-001.blobstore.apple.com/storage?part=1", offset: 0, length: 3, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
        { method: "PUT", url: "https://store-001.blobstore.apple.com/storage?part=2", offset: 3, length: 5, requestHeaders: [] },
      ] } } };
    } else if (path === "/v1/appScreenshots/reservation-a") result = { data: { id: "reservation-a", attributes: { fileSize: file.length, uploadOperations: [
      { method: "PUT", url: "https://store-001.blobstore.apple.com/storage?part=all", offset: 0, length: file.length, requestHeaders: [] },
    ] } } };
    else if (path === "/v1/appAssetLibraryImages/image-a") result = image(pending ? "UPLOAD_COMPLETE" : "PREPARE_FOR_SUBMISSION");
    else if (path === "/v1/appStoreVersionLocalizations/locale-a/placements") result = { data: reused ? [{ id: "placement-a", relationships: { image: { data: { id: "image-a" } } } }] : [] };
    else if (path === "/v1/appAssetLibraryPlacements") result = { data: { id: "placement-a" } };
    else if (path.endsWith("/values")) { response.setHeader("content-type", "text/csv"); response.end("one,two\n1,2\n"); return; }
    response.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not start");
  const fixtureFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    return globalThis.fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  }) as typeof fetch;
  app = await testApp({ caller: callerFor(admin.sub, [{ id: orgId, name: "Uploads" }]), fetch: fixtureFetch, assetFetch: fixtureFetch });
  connectionId = newConnectionId();
  const privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await app.runtime.runPromise(Effect.gen(function* () {
    const parsed = yield* parseCredentials({ kind: "team", issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "UPLOAD0001", privateKey });
    const encryptedPrivateKey = yield* Crypto.use((crypto) => crypto.encrypt(parsed.privateKeyPem, connectionSecretAad(orgId, connectionId)));
    yield* insertConnection(admin, { id: connectionId, name: "Upload fixture", key: { kind: "team", issuerId: "57246542-96fe-1a63-e053-0824d011072a" }, keyId: "UPLOAD0001", encryptedPrivateKey, vendorNumber: null });
  }));
});
afterAll(async () => {
  if (app && connectionId) await app.runtime.runPromise(deleteConnection(admin, connectionId));
  await app?.dispose();
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => { calls.length = 0; storageFails = false; reservationFails = false; pending = false; wrongApp = false; reused = false; foreignImage = false; });
const call = async (name: string, args: Record<string, unknown>) => {
  const { body } = await rpc(app.app, "tools/call", { name, arguments: args });
  return { ...body.result, value: JSON.parse(body.result.content[0].text) };
};
const screenshot = { app_id: "app-a", localization_id: "locale-a", placement_group: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", file_name: "home.png", content_base64: file.toString("base64") };

describe("generated operations and uploads over HTTP", () => {
  it("executes generated methods with validation before network access", async () => {
    const get = operations.find((operation) => operation.operationId === "apps_getInstance")!;
    await call(get.name, { path: { id: "a/b" }, query: { "fields[apps]": ["name", "bundleId"] } });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/apps/a%2Fb", accept: "application/json" });
    const before = calls.length;
    expect((await call(get.name, { path: { id: ".." } })).isError).toBe(true);
    expect(calls).toHaveLength(before);
    const patch = operations.find((operation) => operation.operationId === "appStoreVersionLocalizations_updateInstance")!;
    await call(patch.name, { path: { id: "locale-a" }, body: { data: { type: "appStoreVersionLocalizations", id: "locale-a", attributes: { keywords: "fit" } } } });
    const post = operations.find((operation) => operation.operationId === "customerReviewResponses_createInstance")!;
    await call(post.name, { body: { data: { type: "customerReviewResponses", attributes: { responseBody: "Thanks" }, relationships: { review: { data: { type: "customerReviews", id: "review-a" } } } } } });
    const del = operations.find((operation) => operation.operationId === "bundleIds_deleteInstance")!;
    await call(del.name, { path: { id: "bundle-a" } });
    expect(calls.map((request) => request.method)).toEqual(["GET", "PATCH", "POST", "DELETE"]);
  });

  it("transfers an existing reservation and returns file checksums without committing it", async () => {
    const result = await call("upload_asset", { operation: "appScreenshots_getInstance", resource_id: "reservation-a", file_name: "home.png", content_base64: file.toString("base64") });
    expect(result.isError).not.toBe(true);
    expect(result.value).toMatchObject({ state: "uploaded", resource_id: "reservation-a", bytes: 8, md5: "e8dc4081b13434b45189a720b77b6818", sha256: "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab" });
    expect(calls.map((request) => request.method)).toEqual(["GET", "PUT"]);
    expect(calls[1]!.authorization).toBe("");
    expect(calls[1]!.body).toEqual(file);
  });

  it("uploads exact slices without credentials, commits, then places the image", async () => {
    const result = await call("upload_screenshot", screenshot);
    expect(result.isError).not.toBe(true);
    expect(result.value).toMatchObject({ state: "placed", image_id: "image-a", placement_id: "placement-a" });
    const transfers = calls.filter((request) => request.path === "/storage");
    expect(transfers.map((request) => request.body.toString())).toEqual(["abc", "defgh"]);
    expect(transfers.every((request) => request.authorization === "")).toBe(true);
    expect(calls.filter((request) => request.path !== "/storage").every((request) => request.authorization.startsWith("Bearer "))).toBe(true);
    const commitIndex = calls.findIndex((request) => request.method === "PATCH");
    expect(commitIndex).toBeGreaterThan(calls.findLastIndex((request) => request.path === "/storage"));
    expect(JSON.parse(calls[commitIndex]!.body.toString()).data.attributes).toEqual({ uploaded: true });
    expect(calls.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("returns processing progress and resumes without reserving, uploading, or duplicating placement", async () => {
    pending = true;
    const first = await call("upload_screenshot", screenshot);
    expect(first.value).toMatchObject({ state: "processing", image_id: "image-a" });
    expect(calls.some((request) => request.path === "/v1/appAssetLibraryPlacements")).toBe(false);
    pending = false; reused = true; calls.length = 0;
    const next = await call("upload_screenshot", { app_id: "app-a", localization_id: "locale-a", placement_group: screenshot.placement_group, image_id: "image-a" });
    expect(next.value).toMatchObject({ state: "placed", placement_id: "placement-a", reused: true });
    expect(calls.every((request) => request.method === "GET")).toBe(true);
  });

  it("fails closed on another app or library and retains Apple's actionable errors", async () => {
    wrongApp = true;
    expect((await call("upload_screenshot", screenshot)).isError).toBe(true);
    expect(calls.some((request) => request.method === "POST")).toBe(false);
    wrongApp = false; reservationFails = true;
    const failed = await call("upload_screenshot", screenshot);
    expect(failed.value).toMatchObject({ error: "asset_upload", stage: "reserve", message: "The key cannot manage assets.", details: { status: 403, errors: [{ code: "FORBIDDEN" }] } });
    reservationFails = false; foreignImage = true; calls.length = 0;
    expect((await call("upload_screenshot", { app_id: "app-a", localization_id: "locale-a", placement_group: screenshot.placement_group, image_id: "foreign" })).isError).toBe(true);
    expect(calls.every((request) => request.method === "GET")).toBe(true);
  });

  it("keeps reservation progress and never commits after a failed transfer", async () => {
    storageFails = true;
    const result = await call("upload_screenshot", screenshot);
    expect(result.value).toMatchObject({ error: "asset_upload", stage: "transfer", image_id: "image-a" });
    expect(calls.some((request) => request.method === "PATCH")).toBe(false);
    expect(calls.some((request) => request.path === "/v1/appAssetLibraryPlacements")).toBe(false);
  });

  it("negotiates a CSV-only operation and returns its exact binary resource", async () => {
    const operation = operations.find((operation) => operation.responseMedia.length === 1 && operation.responseMedia[0] === "text/csv")!;
    const result = await call(operation.name, { path: { id: "codes-a" }, response_limit: 4 });
    expect(calls[0]!.accept).toBe("text/csv");
    expect(result.value).toMatchObject({ totalBytes: 12, nextOffset: 4, mimeType: "text/csv" });
    expect(result.content[1]).toMatchObject({ resource: { blob: Buffer.from("one,").toString("base64") } });
  });
});
