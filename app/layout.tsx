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
  title: "Forewarned",
  description: "Know what's about to break in the APIs your code depends on, and get tested fix PRs before it happens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-800/80">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-zinc-100">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]" />
              Forewarned
            </Link>
            <span className="hidden font-mono text-xs text-zinc-500 sm:block">self-maintaining APIs</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
