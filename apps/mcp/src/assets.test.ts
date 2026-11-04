import { describe, expect, it } from "vitest";
import { fileBytes, isPublicAddress, publicSourceUrl, transferBytes, uploadPlan } from "./assets";

const bytes = Buffer.from("abcdefgh");
const reservation = () => ({ data: { attributes: { fileSize: bytes.length, uploadOperations: [
  { method: "PUT", url: "https://store-001.blobstore.apple.com/asset?token=one", offset: 0, length: 3, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
  { method: "PUT", url: "https://store-001.blobstore.apple.com/asset?token=two", offset: 3, length: 5, requestHeaders: [] },
] } } });

describe("hosted file boundaries", () => {
  it("decodes exact canonical base64 without reading local paths", async () => {
    expect(await fileBytes({ file_name: "home.png", content_base64: bytes.toString("base64") })).toEqual(bytes);
    for (const input of [
      { file_name: "../home.png", content_base64: "YQ==" },
      { file_name: "home.png", content_base64: "YQ" },
      { file_name: "home.png", content_base64: "YR==" },
      { file_name: "home.png", content_base64: "" },
      { file_name: "home.png", content_base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") },
      { file_name: "home.png", content_base64: "YQ==", source_url: "https://example.com/image.png" },
    ]) await expect(fileBytes(input)).rejects.toThrow();
  });

  it("refuses local, special, IPv4-mapped, and transition destinations", () => {
    for (const address of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.0.1", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001::1", "2002:7f00:1::", "2001:db8::1", "2001:2::1"]) expect(isPublicAddress(address), address).toBe(false);
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) expect(isPublicAddress(address), address).toBe(true);
    for (const url of ["http://example.com/a", "https://user:pass@example.com/a", "https://example.com:444/a", "https://127.0.0.1/a", "https://[::1]/a", "https://example.com/a#fragment"]) expect(() => publicSourceUrl(url), url).toThrow();
  });
});

describe("Apple-issued raw upload plans", () => {
  it("sends exact byte slices with Apple's headers and no API credential", async () => {
    const calls: { input: string; init: RequestInit }[] = [];
    const fetch = (async (input, init) => { calls.push({ input: String(input), init: init! }); return new Response(null, { status: 204 }); }) as typeof globalThis.fetch;
    await expect(transferBytes(reservation(), bytes, fetch)).resolves.toEqual({ parts: 2, bytes: 8 });
    expect(calls.map((call) => Buffer.from(call.init.body as Uint8Array).toString())).toEqual(["abc", "defgh"]);
    for (const call of calls) {
      expect(call.init.redirect).toBe("error");
      expect(new Headers(call.init.headers).has("authorization")).toBe(false);
      expect(call.init.method).toBe("PUT");
    }
  });

  it("lets fetch set Content-Length for an Apple header that matches the byte range", () => {
    const body = reservation();
    body.data.attributes.uploadOperations[0]!.requestHeaders.push({ name: "Content-Length", value: "3" });
    expect(uploadPlan(body, bytes.length)[0]!.requestHeaders).toEqual([{ name: "Content-Type", value: "image/png" }]);
    body.data.attributes.uploadOperations[0]!.requestHeaders[1]!.value = "4";
    expect(() => uploadPlan(body, bytes.length)).toThrow("Content-Length");
  });

  it("rejects hostile destinations, headers, size mismatch, overlap, and gaps before fetch", () => {
    const variants = [
      (body: ReturnType<typeof reservation>) => { body.data.attributes.fileSize++; },
      (body: ReturnType<typeof reservation>) => { body.data.attributes.uploadOperations[0]!.url = "https://evil.example/asset"; },
      (body: ReturnType<typeof reservation>) => { body.data.attributes.uploadOperations[0]!.url = "http://store-001.blobstore.apple.com/asset"; },
      (body: ReturnType<typeof reservation>) => { body.data.attributes.uploadOperations[0]!.requestHeaders = [{ name: "Authorization", value: "Bearer secret" }]; },
      (body: ReturnType<typeof reservation>) => { body.data.attributes.uploadOperations[1]!.offset = 2; },
      (body: ReturnType<typeof reservation>) => { body.data.attributes.uploadOperations[1]!.offset = 4; },
      (body: ReturnType<typeof reservation>) => { body.data.attributes.uploadOperations.pop(); },
    ];
    for (const change of variants) { const body = reservation(); change(body); expect(() => uploadPlan(body, bytes.length)).toThrow(); }
  });

  it("stops after a failed part and never commits a reservation", async () => {
    let calls = 0;
    const fetch = (async () => { calls++; return new Response(null, { status: 500 }); }) as typeof globalThis.fetch;
    await expect(transferBytes(reservation(), bytes, fetch)).rejects.toThrow("Upload part 0");
    expect(calls).toBe(1);
  });
});
