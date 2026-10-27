import type { Metadata } from "next";
import { DM_Mono, Geist, Instrument_Sans } from "next/font/google";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Instrument_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600"],
});
const mono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "PERSUNA: your method, multiplied", template: "%s · PERSUNA" },
  description:
    "Persuna is an AI assistant on your screen that keeps you on track, learns how you work, does it your way for your approval, and lets you rent your method to others per task.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
