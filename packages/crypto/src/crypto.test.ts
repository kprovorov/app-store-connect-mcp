import { ConfigProvider, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { Crypto, type EncryptedSecret, decrypt, encrypt, parseKeyring } from "./index";

const key = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const v1 = `1:${key()}`;
const v2 = `2:${key()}`;
const aad = "org_abc:7f0c5e1e-4a4b-4c1f-9d61-0f2d8f6a1b2c";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect)) as Promise<E>;

describe("encrypt and decrypt", () => {
  it("round trips and never repeats a ciphertext", async () => {
    const keyring = await run(parseKeyring(v1));
    const a = await run(encrypt(keyring, "synthetic private key text", aad));
    const b = await run(encrypt(keyring, "synthetic private key text", aad));
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(await run(decrypt(keyring, a, aad))).toBe("synthetic private key text");
  });

  it("fails when the AAD differs", async () => {
    const keyring = await run(parseKeyring(v1));
    const secret = await run(encrypt(keyring, "p8", aad));
    const error = await failure(decrypt(keyring, secret, "org_abc:00000000-0000-4000-8000-000000000000"));
    expect(error).toMatchObject({ _tag: "DecryptError", reason: "auth_failed" });
  });

  it("fails when the ciphertext is tampered with", async () => {
    const keyring = await run(parseKeyring(v1));
    const secret = await run(encrypt(keyring, "p8", aad));
    const [version, iv, sealed] = secret.split(".") as [string, string, string];
    const bytes = Buffer.from(sealed, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = `${version}.${iv}.${bytes.toString("base64url")}` as EncryptedSecret;
    expect(await failure(decrypt(keyring, tampered, aad))).toMatchObject({ reason: "auth_failed" });
  });

  it("reports malformed envelopes and unknown versions", async () => {
    const keyring = await run(parseKeyring(v1));
    expect(await failure(decrypt(keyring, "not-a-secret" as EncryptedSecret, aad))).toMatchObject({
      reason: "malformed",
    });
    const secret = await run(encrypt(await run(parseKeyring(v2)), "p8", aad));
    expect(await failure(decrypt(keyring, secret, aad))).toMatchObject({ reason: "unknown_version" });
  });

  it("keeps decrypting v1 secrets after v2 is added, and encrypts new ones with v2", async () => {
    const old = await run(encrypt(await run(parseKeyring(v1)), "p8", aad));
    const rotated = await run(parseKeyring(`${v2},${v1}`));
    expect(await run(decrypt(rotated, old, aad))).toBe("p8");
    const fresh = await run(encrypt(rotated, "p8", aad));
    expect(fresh.startsWith("v2.")).toBe(true);
    expect(await run(decrypt(rotated, fresh, aad))).toBe("p8");
  });
});

describe("parseKeyring", () => {
  it.each([
    ["empty", ""],
    ["missing version", key()],
    ["wrong key length", `1:${Buffer.alloc(16).toString("base64")}`],
    ["not base64", "1:not*base64"],
    ["duplicate versions", `1:${key()},1:${key()}`],
    ["version zero", `0:${key()}`],
  ])("rejects %s", async (_, raw) => {
    expect(await failure(parseKeyring(raw))).toMatchObject({ _tag: "KeyringError" });
  });
});

describe("Crypto.layerFromEnv", () => {
  it("reads ENCRYPTION_KEYS and fails on a malformed value", async () => {
    const program = Effect.gen(function* () {
      const crypto = yield* Crypto;
      return yield* crypto.decrypt(yield* crypto.encrypt("p8", aad), aad);
    }).pipe(Effect.provide(Crypto.layerFromEnv));
    const withEnv = (ENCRYPTION_KEYS: string) =>
      program.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENCRYPTION_KEYS }))));

    expect(await run(withEnv(`${v1},${v2}`))).toBe("p8");
    const exit = await Effect.runPromiseExit(withEnv("1:short"));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
