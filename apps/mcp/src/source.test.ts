import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ addresses: [{ address: "8.8.8.8", family: 4 }], status: 200, bytes: Buffer.from("image"), declaredLength: "5", lookupAll: false, requested: 0 }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => state.addresses) }));
vi.mock("node:https", () => ({ request: vi.fn((_url, options, responseCallback) => {
  state.requested++;
  const req = new EventEmitter() as EventEmitter & { end(): void; destroy(error?: Error): void };
  req.destroy = (error?: Error) => { if (error) req.emit("error", error); req.emit("close"); };
  req.end = () => {
    options.lookup("example.com", { all: state.lookupAll }, (error: Error | null, address: unknown, family?: number) => {
      if (error) { req.emit("error", error); return; }
      if (state.lookupAll) expect(address).toEqual([state.addresses[0]]);
      else { expect(address).toBe(state.addresses[0]!.address); expect(family).toBe(state.addresses[0]!.family); }
      const response = Readable.from([state.bytes]) as Readable & { statusCode: number; headers: object };
      response.statusCode = state.status;
      response.headers = { "content-length": state.declaredLength };
      response.on("close", () => req.emit("close"));
      responseCallback(response);
    });
  };
  return req;
}) }));
import { downloadSource } from "./assets";
afterEach(() => { state.addresses = [{ address: "8.8.8.8", family: 4 }]; state.status = 200; state.bytes = Buffer.from("image"); state.declaredLength = "5"; state.lookupAll = false; state.requested = 0; });

describe("public source download", () => {
  it("pins DNS and supports both Node lookup callback shapes", async () => {
    expect(Buffer.from(await downloadSource("https://example.com/image.png")).toString()).toBe("image");
    state.lookupAll = true;
    expect(Buffer.from(await downloadSource("https://example.com/image.png")).toString()).toBe("image");
  });
  it("rejects a mixed public/private DNS answer before opening HTTPS", async () => {
    state.addresses.push({ address: "127.0.0.1", family: 4 });
    await expect(downloadSource("https://example.com/image.png")).rejects.toThrow("public IP");
    expect(state.requested).toBe(0);
  });
  it("rejects redirects and oversized source bodies", async () => {
    state.status = 302;
    await expect(downloadSource("https://example.com/image.png")).rejects.toThrow("redirects");
    state.status = 200; state.declaredLength = String(21 * 1024 * 1024);
    await expect(downloadSource("https://example.com/image.png")).rejects.toThrow("20 MiB");
  });
});
