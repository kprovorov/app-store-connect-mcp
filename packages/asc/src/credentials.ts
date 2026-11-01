import { type Brand, Data, Effect } from "effect";
import { importPKCS8 } from "jose";

export type KeyId = string & Brand.Brand<"AscKeyId">;
export type IssuerId = string & Brand.Brand<"AscIssuerId">;
/** PKCS#8 PEM holding a P-256 private key, as Apple's `.p8` file. */
export type PrivateKeyPem = string & Brand.Brand<"AscPrivateKeyPem">;

export type AscCredentials =
  | { readonly kind: "team"; readonly issuerId: IssuerId; readonly keyId: KeyId; readonly privateKeyPem: PrivateKeyPem }
  | { readonly kind: "individual"; readonly keyId: KeyId; readonly privateKeyPem: PrivateKeyPem };

export interface RawCredentials {
  readonly kind: string;
  readonly issuerId?: string | null | undefined;
  readonly keyId: string;
  readonly privateKey: string;
}

export class InvalidCredentials extends Data.TaggedError("InvalidCredentials")<{
  readonly field: "kind" | "issuerId" | "keyId" | "privateKey";
  readonly message: string;
}> {}

const KEY_ID = /^[A-Z0-9]{10}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parsePrivateKey = (raw: string) =>
  Effect.gen(function* () {
    const pem = raw.replace(/\r\n?/g, "\n").trim();
    yield* Effect.tryPromise({
      try: () => importPKCS8(pem, "ES256"),
      catch: () =>
        new InvalidCredentials({
          field: "privateKey",
          message: "Paste the full contents of the .p8 file, including the BEGIN and END PRIVATE KEY lines",
        }),
    });
    return pem as PrivateKeyPem;
  });

export const parseCredentials = (raw: RawCredentials): Effect.Effect<AscCredentials, InvalidCredentials> =>
  Effect.gen(function* () {
    const keyId = raw.keyId.trim();
    if (!KEY_ID.test(keyId)) {
      return yield* new InvalidCredentials({ field: "keyId", message: "Key ID is 10 uppercase letters and digits" });
    }
    if (raw.kind === "individual") {
      return { kind: "individual", keyId: keyId as KeyId, privateKeyPem: yield* parsePrivateKey(raw.privateKey) };
    }
    if (raw.kind !== "team") {
      return yield* new InvalidCredentials({ field: "kind", message: "Key type must be team or individual" });
    }
    const issuerId = (raw.issuerId ?? "").trim();
    if (!UUID.test(issuerId)) {
      return yield* new InvalidCredentials({ field: "issuerId", message: "Issuer ID is a UUID" });
    }
    return {
      kind: "team",
      issuerId: issuerId as IssuerId,
      keyId: keyId as KeyId,
      privateKeyPem: yield* parsePrivateKey(raw.privateKey),
    };
  });
