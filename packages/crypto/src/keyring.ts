import { Data, Effect } from "effect";

export interface Keyring {
  readonly active: { readonly version: number; readonly key: CryptoKey };
  readonly keys: ReadonlyMap<number, CryptoKey>;
}

export class KeyringError extends Data.TaggedError("KeyringError")<{
  readonly message: string;
}> {}

const KEY_BYTES = 32;
const ENTRY = /^(\d+):([A-Za-z0-9+/]+={0,2})$/;

const parseEntries = (raw: string): Effect.Effect<ReadonlyMap<number, Uint8Array<ArrayBuffer>>, KeyringError> =>
  Effect.gen(function* () {
    const entries = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      return yield* new KeyringError({ message: "ENCRYPTION_KEYS is empty" });
    }
    const keys = new Map<number, Uint8Array<ArrayBuffer>>();
    for (const [index, entry] of entries.entries()) {
      const match = ENTRY.exec(entry);
      if (!match) {
        return yield* new KeyringError({
          message: `ENCRYPTION_KEYS entry ${index + 1} must look like <version>:<base64 key>`,
        });
      }
      const version = Number(match[1]);
      if (!Number.isSafeInteger(version) || version < 1) {
        return yield* new KeyringError({ message: `ENCRYPTION_KEYS entry ${index + 1} has an invalid version` });
      }
      if (keys.has(version)) {
        return yield* new KeyringError({ message: `ENCRYPTION_KEYS has duplicate version ${version}` });
      }
      const bytes = new Uint8Array(Buffer.from(match[2] ?? "", "base64"));
      if (bytes.length !== KEY_BYTES) {
        return yield* new KeyringError({
          message: `ENCRYPTION_KEYS version ${version} is ${bytes.length} bytes, expected ${KEY_BYTES}`,
        });
      }
      keys.set(version, bytes);
    }
    return keys;
  });

/** Parses `ENCRYPTION_KEYS` (`<version>:<base64 32 bytes>,...`). The highest version encrypts. */
export const parseKeyring = (raw: string): Effect.Effect<Keyring, KeyringError> =>
  Effect.gen(function* () {
    const entries = yield* parseEntries(raw);
    const keys = new Map<number, CryptoKey>();
    let active: Keyring["active"] | undefined;
    for (const [version, bytes] of entries) {
      const key = yield* Effect.promise(() =>
        globalThis.crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
      );
      keys.set(version, key);
      if (!active || version > active.version) active = { version, key };
    }
    if (!active) return yield* new KeyringError({ message: "ENCRYPTION_KEYS is empty" });
    return { active, keys };
  });
