import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Pages need a signed-in session. API routes check their own callers (you, the
// iOS Shortcut or the Mac agent) in lib/auth.ts, because two of those use tokens.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/api/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
