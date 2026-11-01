import { Clock, Context, Data, type Duration, Effect, Layer, Schedule, Schema } from "effect";
import type { AscCredentials } from "./credentials";
import { type AscAuthError, signToken, signTokenWithExpiry } from "./token";

export const ASC_ORIGIN = "https://api.appstoreconnect.apple.com";
const VERSIONED_PATH = /^\/v[1-9]\//;
const TOKEN_REFRESH_MARGIN_MILLIS = 60_000;
const MAX_RETRIES = 2;

export type AscMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface AscRequest {
  readonly method: AscMethod;
  /** `/v1/...` through `/v9/...`, or a `links.next` URL on the ASC host. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | ReadonlyArray<string>>>;
  readonly body?: unknown;
  /**
   * Sign a one-off token whose `scope` claim allows only this method, path, and query.
   * Apple rejects the token for any other request, so a bug in our code cannot widen it.
   */
  readonly scoped?: boolean;
}

export interface RateLimit {
  readonly limit: number;
  readonly remaining: number;
}

export type AscBody =
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "bytes"; readonly contentType: string; readonly value: Uint8Array }
  | { readonly kind: "empty" };

export interface AscResponse {
  readonly status: number;
  readonly rateLimit: RateLimit | undefined;
  readonly body: AscBody;
}

const AscErrorEntry = Schema.Struct({
  status: Schema.String,
  code: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  source: Schema.optionalKey(
    Schema.Struct({ pointer: Schema.optionalKey(Schema.String), parameter: Schema.optionalKey(Schema.String) }),
  ),
});
export type AscErrorEntry = typeof AscErrorEntry.Type;
const decodeErrorResponse = Schema.decodeUnknownOption(Schema.Struct({ errors: Schema.Array(AscErrorEntry) }));

export class AscApiError extends Data.TaggedError("AscApiError")<{
  readonly status: number;
  readonly errors: ReadonlyArray<AscErrorEntry>;
  readonly rateLimit: RateLimit | undefined;
}> {}

export class AscRateLimited extends Data.TaggedError("AscRateLimited")<{
  readonly retryAfterSeconds: number | undefined;
  readonly rateLimit: RateLimit | undefined;
}> {}

export class AscNetworkError extends Data.TaggedError("AscNetworkError")<{
  readonly cause: unknown;
}> {}

export class AscInvalidPath extends Data.TaggedError("AscInvalidPath")<{
  readonly path: string;
}> {}

export type AscRequestError = AscApiError | AscRateLimited | AscNetworkError | AscInvalidPath | AscAuthError;

/** Parses `X-Rate-Limit: user-hour-lim:3500;user-hour-rem:500;`. */
export const parseRateLimit = (header: string | null | undefined): RateLimit | undefined => {
  if (!header) return undefined;
  const fields = new Map(
    header
      .split(";")
      .map((part) => part.split(":").map((s) => s.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  const limit = Number(fields.get("user-hour-lim"));
  const remaining = Number(fields.get("user-hour-rem"));
  if (!fields.has("user-hour-lim") || !fields.has("user-hour-rem")) return undefined;
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return undefined;
  return { limit, remaining };
};

export const resolveUrl = (request: AscRequest): URL | undefined => {
  const { path } = request;
  const relative = path.startsWith("/") && !path.startsWith("//");
  if (!relative && !path.startsWith(`${ASC_ORIGIN}/`)) return undefined;
  const url = URL.parse(path, ASC_ORIGIN);
  if (!url || url.origin !== ASC_ORIGIN || !VERSIONED_PATH.test(url.pathname)) return undefined;
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url;
};

// Apple ignores these when matching a request against the token scope.
const UNSCOPED_PARAMS = new Set(["limit", "cursor", "sort"]);

/** `GET /v1/apps?filter[platform]=IOS`, the scope entry format Apple documents (brackets unencoded). */
const scopeFor = (method: AscMethod, url: URL) => {
  const query = [...url.searchParams]
    .filter(([name]) => !UNSCOPED_PARAMS.has(name))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return `${method} ${url.pathname}${query ? `?${query}` : ""}`;
};

const isJson = (contentType: string) => /[/+]json\b/i.test(contentType);

const readBody = async (response: Response): Promise<AscBody> => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) return { kind: "empty" };
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (isJson(contentType)) return { kind: "json", value: JSON.parse(new TextDecoder().decode(bytes)) };
  return { kind: "bytes", contentType, value: bytes };
};

const credentialFingerprint = async (creds: AscCredentials) => {
  const identity = [creds.kind, creds.kind === "team" ? creds.issuerId : "", creds.keyId, creds.privateKeyPem].join("\n");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Buffer.from(digest).toString("hex");
};

export interface AscClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly retryBaseDelay?: Duration.Input;
}

export class AscClient extends Context.Service<
  AscClient,
  {
    request(creds: AscCredentials, request: AscRequest): Effect.Effect<AscResponse, AscRequestError>;
  }
>()("@asc-mcp/asc/AscClient") {
  static readonly make = (options: AscClientOptions = {}): AscClient["Service"] => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const tokens = new Map<string, { readonly token: string; readonly expiresAtMillis: number }>();

    // Keyed by a hash of the whole credential, not the key ID alone, so a row that reuses
    // another tenant's key ID with a different private key can never receive that tenant's token.
    const tokenFor = (creds: AscCredentials) =>
      Effect.gen(function* () {
        const cacheKey = yield* Effect.promise(() => credentialFingerprint(creds));
        const now = yield* Clock.currentTimeMillis;
        const cached = tokens.get(cacheKey);
        if (cached && cached.expiresAtMillis - TOKEN_REFRESH_MARGIN_MILLIS > now) return cached.token;
        const signed = yield* signTokenWithExpiry(creds);
        tokens.set(cacheKey, signed);
        return signed.token;
      });

    const send = (url: URL, request: AscRequest, token: string) =>
      Effect.gen(function* () {
        const { response, body } = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await fetchImpl(url, {
              method: request.method,
              signal,
              headers: {
                authorization: `Bearer ${token}`,
                accept: "application/json",
                ...(request.body === undefined ? {} : { "content-type": "application/json" }),
              },
              ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
            });
            return { response, body: await readBody(response) };
          },
          catch: (cause) => new AscNetworkError({ cause }),
        });
        const rateLimit = parseRateLimit(response.headers.get("x-rate-limit"));
        if (response.ok) return { status: response.status, rateLimit, body };
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after") ?? Number.NaN);
          return yield* new AscRateLimited({
            retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
            rateLimit,
          });
        }
        const decoded = body.kind === "json" ? decodeErrorResponse(body.value) : undefined;
        return yield* new AscApiError({
          status: response.status,
          rateLimit,
          errors: decoded?._tag === "Some" ? decoded.value.errors : [],
        });
      });

    // A 5xx on a write may have been applied, so only reads retry server errors.
    const retryable = (method: AscMethod) => (error: AscRequestError) =>
      error._tag === "AscRateLimited" || (error._tag === "AscApiError" && error.status >= 500 && method === "GET");

    const request = (creds: AscCredentials, request: AscRequest) =>
      Effect.gen(function* () {
        const url = resolveUrl(request);
        if (!url) return yield* new AscInvalidPath({ path: request.path });
        const token = request.scoped
          ? yield* signToken(creds, { scope: [scopeFor(request.method, url)] })
          : yield* tokenFor(creds);
        return yield* send(url, request, token).pipe(
          Effect.retry({
            schedule: Schedule.exponential(options.retryBaseDelay ?? "500 millis"),
            times: MAX_RETRIES,
            while: retryable(request.method),
          }),
        );
      });

    return AscClient.of({ request });
  };

  static readonly layerWith = (options: AscClientOptions) => Layer.sync(AscClient, () => AscClient.make(options));
  static readonly layer = AscClient.layerWith({});
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "invalid_key" | "forbidden" | "network"; readonly detail: string };

const firstDetail = (error: AscApiError) => error.errors[0]?.detail;

/** Live check that the key works: `GET /v1/apps?limit=1`. */
export const verifyCredentials = (creds: AscCredentials): Effect.Effect<VerifyResult, never, AscClient> =>
  AscClient.use((client) => client.request(creds, { method: "GET", path: "/v1/apps", query: { limit: 1 } })).pipe(
    Effect.as<VerifyResult>({ ok: true }),
    Effect.catch((error): Effect.Effect<VerifyResult> => {
      switch (error._tag) {
        case "AscApiError":
          if (error.status === 401) {
            return Effect.succeed({
              ok: false,
              reason: "invalid_key",
              detail: firstDetail(error) ?? "Apple rejected the key. Check the key ID, issuer ID, and .p8 file.",
            });
          }
          if (error.status === 403) {
            return Effect.succeed({
              ok: false,
              reason: "forbidden",
              detail: `The key is valid, but its role cannot list apps.${firstDetail(error) ? ` ${firstDetail(error)}` : ""}`,
            });
          }
          return Effect.succeed({ ok: false, reason: "network", detail: `App Store Connect returned ${error.status}` });
        case "AscAuthError":
          return Effect.succeed({ ok: false, reason: "invalid_key", detail: error.message });
        case "AscRateLimited":
          return Effect.succeed({ ok: false, reason: "network", detail: "The key hit its hourly rate limit" });
        case "AscNetworkError":
        case "AscInvalidPath":
          return Effect.succeed({ ok: false, reason: "network", detail: "Could not reach App Store Connect" });
      }
    }),
  );
