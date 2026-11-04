import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShotListed",
  description: "Turn saved reels into plans you can shoot and edit.",
  appleWebApp: { capable: true, title: "ShotListed", statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
        <body className="flex min-h-full flex-col font-sans">
          <Show when="signed-in">
            <header className="sticky top-0 z-10 border-b border-line bg-background/90 backdrop-blur">
              <nav className="mx-auto flex max-w-5xl items-center gap-5 px-4 py-3 text-sm">
                <Link href="/library" className="font-semibold tracking-tight">
                  ShotListed
                </Link>
                <Link href="/inbox" className="text-muted hover:text-foreground">
                  Inbox
                </Link>
                <Link href="/ideas" className="text-muted hover:text-foreground">
                  Ideas
                </Link>
                <Link href="/plans" className="text-muted hover:text-foreground">
                  Plans
                </Link>
                <Link href="/shoot" className="text-muted hover:text-foreground">
                  Shoot
                </Link>
                <Link href="/board" className="text-muted hover:text-foreground">
                  Board
                </Link>
                <Link href="/library" className="text-muted hover:text-foreground">
                  Library
                </Link>
                <Link href="/finals" className="text-muted hover:text-foreground">
                  Captions
                </Link>
                <Link href="/settings" className="text-muted hover:text-foreground">
                  Settings
                </Link>
                <span className="ml-auto">
                  <UserButton />
                </span>
              </nav>
            </header>
          </Show>
          <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
