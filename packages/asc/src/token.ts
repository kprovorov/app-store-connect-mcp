import { Clock, Data, Effect } from "effect";
import { SignJWT, importPKCS8 } from "jose";
import type { AscCredentials } from "./credentials";

export const AUDIENCE = "appstoreconnect-v1";
export const DEFAULT_TTL_SECONDS = 15 * 60;
// Apple rejects most tokens whose exp - iat exceeds 20 minutes.
export const MAX_TTL_SECONDS = 20 * 60;

export class AscAuthError extends Data.TaggedError("AscAuthError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SignOptions {
  /** Entries like `"GET /v1/apps?filter[platform]=IOS"`. */
  readonly scope?: ReadonlyArray<string>;
  readonly ttlSeconds?: number;
}

export interface SignedToken {
  readonly token: string;
  readonly expiresAtMillis: number;
}

export const clampTtl = (ttlSeconds: number | undefined) =>
  Math.min(MAX_TTL_SECONDS, Math.max(1, Math.floor(ttlSeconds ?? DEFAULT_TTL_SECONDS)));

export const signTokenWithExpiry = (
  creds: AscCredentials,
  options: SignOptions = {},
): Effect.Effect<SignedToken, AscAuthError> =>
  Effect.gen(function* () {
    const iat = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const exp = iat + clampTtl(options.ttlSeconds);
    const token = yield* Effect.tryPromise({
      try: async () => {
        const key = await importPKCS8(creds.privateKeyPem, "ES256");
        const jwt = new SignJWT(options.scope ? { scope: [...options.scope] } : {})
          .setProtectedHeader({ alg: "ES256", kid: creds.keyId, typ: "JWT" })
          .setIssuedAt(iat)
          .setExpirationTime(exp)
          .setAudience(AUDIENCE);
        return (creds.kind === "team" ? jwt.setIssuer(creds.issuerId) : jwt.setSubject("user")).sign(key);
      },
      catch: (cause) => new AscAuthError({ message: "Could not sign an App Store Connect token", cause }),
    });
    return { token, expiresAtMillis: exp * 1000 };
  });

export const signToken = (creds: AscCredentials, options?: SignOptions): Effect.Effect<string, AscAuthError> =>
  Effect.map(signTokenWithExpiry(creds, options), (signed) => signed.token);
