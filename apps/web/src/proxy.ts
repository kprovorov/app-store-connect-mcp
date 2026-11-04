import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Everything else is the dashboard and needs a session with an organization.
// `/choose-organization` must stay public: pending sessions are sent there.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/choose-organization(.*)",
  "/opengraph-image",
  "/twitter-image",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublic(req)) return;
    // `protect()` sends pending sessions (signed in, no org yet) to sign-in, which loops.
    // Send them to the org task instead.
    const { sessionStatus } = await auth({ treatPendingAsSignedOut: false });
    if (sessionStatus === "pending") {
      return NextResponse.redirect(new URL("/choose-organization", req.url));
    }
    await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
