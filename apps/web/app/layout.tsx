import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import "./globals.css";

const mono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PerkOS Runtime",
  description: "Where PerkOS Desks run.",
  icons: { icon: "/logo.png" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={mono.className}>{children}</body>
    </html>
  );
}
