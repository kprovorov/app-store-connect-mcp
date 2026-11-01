import { Config } from "effect";

/** Parsed once at startup. `DATABASE_URL` and `ENCRYPTION_KEYS` belong to the db and crypto layers. */
export const ApiConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(8787)),
  webOrigin: Config.URL("WEB_ORIGIN").pipe(Config.map((url) => url.origin)),
  clerkSecretKey: Config.Redacted("CLERK_SECRET_KEY"),
  clerkPublishableKey: Config.NonEmptyString("CLERK_PUBLISHABLE_KEY"),
});
