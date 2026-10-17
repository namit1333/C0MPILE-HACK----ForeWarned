import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Forewarned — Self-Maintaining APIs",
  description:
    "Dependabot tells you a new version exists. We tell you what's about to break, and what you're missing, before it happens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-black text-[#ededed]">
        <header className="sticky top-0 z-10 border-b border-white/[0.08] bg-black/80 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white">
              <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-white">
                <span className="h-2 w-2 rounded-full bg-black" />
              </span>
              Forewarned
            </Link>
            <span className="font-mono text-xs text-zinc-500">self-maintaining APIs</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
