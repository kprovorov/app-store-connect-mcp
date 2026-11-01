import { Config } from "effect";

export const ApiConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(8787)),
  webOrigin: Config.URL("WEB_ORIGIN").pipe(Config.map((url) => url.origin)),
  clerkSecretKey: Config.Redacted("CLERK_SECRET_KEY"),
  clerkPublishableKey: Config.NonEmptyString("CLERK_PUBLISHABLE_KEY"),
});
