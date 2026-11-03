import { Brand, Data, Effect } from "effect";
import type { Keyring } from "./keyring";

/** `v<version>.<iv base64url>.<ciphertext+tag base64url>`, AES-256-GCM. */
export type EncryptedSecret = string & Brand.Brand<"EncryptedSecret">;

export class DecryptError extends Data.TaggedError("DecryptError")<{
  readonly reason: "malformed" | "unknown_version" | "auth_failed";
}> {}

const IV_BYTES = 12;
const ENVELOPE = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(bytes)).toString("base64url");
const fromBase64Url = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

export const encrypt = (keyring: Keyring, plaintext: string, aad: string): Effect.Effect<EncryptedSecret> =>
  Effect.promise(async () => {
    const { version, key } = keyring.active;
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
      key,
      encoder.encode(plaintext),
    );
    return `v${version}.${toBase64Url(iv)}.${toBase64Url(sealed)}` as EncryptedSecret;
  });

export const decrypt = (keyring: Keyring, secret: EncryptedSecret, aad: string): Effect.Effect<string, DecryptError> =>
  Effect.gen(function* () {
    const match = ENVELOPE.exec(secret);
    if (!match) return yield* new DecryptError({ reason: "malformed" });
    const iv = fromBase64Url(match[2] ?? "");
    if (iv.length !== IV_BYTES) return yield* new DecryptError({ reason: "malformed" });
    const key = keyring.keys.get(Number(match[1]));
    if (!key) return yield* new DecryptError({ reason: "unknown_version" });
    const sealed = fromBase64Url(match[3] ?? "");
    return yield* Effect.tryPromise({
      try: async () =>
        decoder.decode(
          await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, sealed),
        ),
      catch: () => new DecryptError({ reason: "auth_failed" }),
    });
  });
