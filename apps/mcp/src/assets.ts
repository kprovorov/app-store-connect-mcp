import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Data } from "effect";

export const INLINE_FILE_LIMIT = 2 * 1024 * 1024;
export const SOURCE_FILE_LIMIT = 20 * 1024 * 1024;
export class AssetError extends Data.TaggedError("AssetError")<{
  readonly message: string;
  readonly stage?: string;
  readonly image_id?: string;
  readonly details?: unknown;
}> {}
export interface FileSource { file_name: string; content_base64?: string; source_url?: string }
export interface UploadOperation { method: string; url: string; offset: number; length: number; requestHeaders?: { name: string; value: string }[] }

export const isPublicAddress = (address: string) => {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const second = Number.parseInt(lower.split(":")[1] || "0", 16);
    return /^(2|3)[0-9a-f]{3}:/.test(lower) && !lower.startsWith("2002:") && !(lower.startsWith("2001:") && (second < 0x200 || second === 0xdb8));
  }
  return false;
};

export const publicSourceUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash || isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Source must be an HTTPS hostname URL on port 443 without userinfo or a fragment");
  return url;
};

export const downloadSource = async (value: string): Promise<Uint8Array> => {
  const url = publicSourceUrl(value);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Source DNS must resolve only to public IP addresses");
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      family: pinned.family,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
      headers: { accept: "*/*", "accept-encoding": "identity" },
    }, (response) => {
      if (response.statusCode !== 200) { response.destroy(); reject(new Error(`Source returned ${response.statusCode}; redirects are not followed`)); return; }
      const length = Number(response.headers["content-length"]);
      if (length > SOURCE_FILE_LIMIT) { response.destroy(); reject(new Error("Source file exceeds 20 MiB")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > SOURCE_FILE_LIMIT) response.destroy(new Error("Source file exceeds 20 MiB"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    const deadline = setTimeout(() => request.destroy(new Error("Source download exceeded 30 seconds")), 30_000);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", reject);
    request.end();
  });
};

export const fileBytes = async (input: FileSource) => {
  if (!input.file_name || input.file_name.length > 255 || /[\/\\\x00-\x1f]/.test(input.file_name)) throw new Error("file_name must be a filename without path separators");
  if ((input.content_base64 === undefined) === (input.source_url === undefined)) throw new Error("Pass exactly one of content_base64 or source_url");
  if (input.source_url !== undefined) {
    const bytes = await downloadSource(input.source_url);
    if (!bytes.length) throw new Error("Source file is empty");
    return bytes;
  }
  const encoded = input.content_base64!;
  if (encoded.length > Math.ceil(INLINE_FILE_LIMIT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("content_base64 must be canonical base64 for at most 2 MiB");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > INLINE_FILE_LIMIT || bytes.toString("base64") !== encoded) throw new Error("File must contain 1 byte to 2 MiB of canonical base64");
  return bytes;
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Apple upload reservation");
  return value as Record<string, unknown>;
};
export const uploadPlan = (body: unknown, byteLength: number): UploadOperation[] => {
  const attributes = record(record(record(body).data).attributes);
  if (attributes.fileSize !== byteLength) throw new Error("File size does not match Apple's reservation");
  if (!Array.isArray(attributes.uploadOperations) || !attributes.uploadOperations.length) throw new Error("Apple did not return upload operations for this reservation");
  const operations = attributes.uploadOperations.map((value) => {
    const part = record(value);
    if (typeof part.url !== "string") throw new Error("Invalid Apple upload URL");
    const url = new URL(part.url);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".blobstore.apple.com") || url.username || url.password || (url.port && url.port !== "443") || url.hash) throw new Error("Apple upload destination must be an HTTPS blobstore.apple.com host");
    if (part.method !== "PUT" || !Number.isSafeInteger(part.offset) || !Number.isSafeInteger(part.length) || Number(part.offset) < 0 || Number(part.length) < 1 || Number(part.offset) + Number(part.length) > byteLength) throw new Error("Invalid Apple upload byte range");
    if (part.requestHeaders !== undefined && !Array.isArray(part.requestHeaders)) throw new Error("Invalid Apple upload headers");
    const headers = (part.requestHeaders ?? []) as unknown[];
    const checked = headers.map((value) => {
      const header = record(value);
      if (typeof header.name !== "string" || typeof header.value !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name) || /[\r\n]/.test(header.value) || ["authorization", "proxy-authorization", "cookie", "host", "connection", "transfer-encoding", "content-length"].includes(header.name.toLowerCase())) throw new Error("Unsafe Apple upload header");
      return { name: header.name, value: header.value };
    });
    return { method: "PUT", url: part.url, offset: Number(part.offset), length: Number(part.length), requestHeaders: checked };
  }).sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const operation of operations) {
    if (operation.offset !== end) throw new Error("Apple upload ranges must cover the file without gaps or overlaps");
    end += operation.length;
  }
  if (end !== byteLength) throw new Error("Apple upload ranges do not cover the file");
  return operations;
};

export const transferBytes = async (body: unknown, bytes: Uint8Array, fetchImpl: typeof fetch = fetch) => {
  const parts = uploadPlan(body, bytes.length);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const response = await fetchImpl(part.url, {
      method: part.method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: Object.fromEntries(part.requestHeaders!.map(({ name, value }) => [name, value])),
      body: Buffer.from(bytes.subarray(part.offset, part.offset + part.length)),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Upload part ${index} returned HTTP ${response.status}`);
  }
  return { parts: parts.length, bytes: bytes.length };
};
