import { Config, Context, Data, Effect, Layer, Redacted } from "effect";
import { sql } from "drizzle-orm";
import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type RlsClaims, claimsJson } from "./claims";
import * as schema from "./schema";

export type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/** `code` is the Postgres SQLSTATE when the failure came from the server. */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly code: string | undefined;
  readonly message: string;
}> {}

// Keeps only SQLSTATE and message. Drizzle's error carries bound params (claims, ciphertext).
const toDatabaseError = (error: unknown): DatabaseError => {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof postgres.PostgresError) {
      return new DatabaseError({ code: current.code, message: current.message });
    }
    current = current.cause;
  }
  return new DatabaseError({ code: undefined, message: "Database request failed" });
};

export class Database extends Context.Service<
  Database,
  {
    /** Runs `f` in a transaction as role `app_user` with `claims`, so RLS applies. */
    withClaims<A>(claims: RlsClaims, f: (tx: Tx) => Promise<A>): Effect.Effect<A, DatabaseError>;
  }
>()("@asc-mcp/db/Database") {
  static readonly layer = (url: string) =>
    Layer.effect(
      Database,
      Effect.gen(function* () {
        // prepare: false is required behind Supavisor transaction mode and harmless elsewhere.
        const client = yield* Effect.acquireRelease(
          Effect.sync(() => postgres(url, { prepare: false })),
          (client) => Effect.promise(() => client.end()),
        );
        const db = drizzle({ client, schema });
        return Database.of({
          withClaims: (claims, f) =>
            Effect.tryPromise({
              try: () =>
                db.transaction(async (tx) => {
                  await tx.execute(sql`set local role app_user`);
                  await tx.execute(sql`select set_config('request.jwt.claims', ${claimsJson(claims)}, true)`);
                  return f(tx);
                }),
              catch: toDatabaseError,
            }),
        });
      }),
    );

  static readonly layerFromEnv = Layer.unwrap(
    Effect.map(Config.Redacted("DATABASE_URL"), (url) => Database.layer(Redacted.value(url))),
  );
}
