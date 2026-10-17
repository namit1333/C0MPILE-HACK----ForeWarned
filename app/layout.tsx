import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forewarned — what's about to break",
  description:
    "Connect a GitHub repo. See the API inventory, matching provider changes, and open a verified fix PR before the breakage lands.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
