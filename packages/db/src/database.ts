import { Config, Context, Effect, Layer, Redacted } from "effect";
import { sql } from "drizzle-orm";
import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type RlsClaims, claimsJson } from "./claims";
import { type DatabaseError, toDatabaseError } from "./database-error";
import * as schema from "./schema";

export { DatabaseError } from "./database-error";

export type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

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
