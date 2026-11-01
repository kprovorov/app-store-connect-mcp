import { Config, Context, Effect, Layer, Redacted } from "effect";
import { type Keyring, parseKeyring } from "./keyring";
import { type DecryptError, type EncryptedSecret, decrypt, encrypt } from "./secret";

export class Crypto extends Context.Service<
  Crypto,
  {
    encrypt(plaintext: string, aad: string): Effect.Effect<EncryptedSecret>;
    decrypt(secret: EncryptedSecret, aad: string): Effect.Effect<string, DecryptError>;
  }
>()("@asc-mcp/crypto/Crypto") {
  static readonly layer = (keyring: Keyring) =>
    Layer.succeed(Crypto)({
      encrypt: (plaintext, aad) => encrypt(keyring, plaintext, aad),
      decrypt: (secret, aad) => decrypt(keyring, secret, aad),
    });

  static readonly layerFromEnv = Layer.unwrap(
    Effect.gen(function* () {
      const raw = yield* Config.Redacted("ENCRYPTION_KEYS");
      return Crypto.layer(yield* parseKeyring(Redacted.value(raw)));
    }),
  );
}
