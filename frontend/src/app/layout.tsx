import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Fecal Classification — Clinical microscopy assistant",
    template: "%s · Fecal Classification",
  },
  description:
    "Upload microscopic slides, run staged fecal detection, binary classification, and multi-class overlays — built for clinical workflows.",
  openGraph: {
    title: "Fecal Classification",
    description:
      "AI-assisted microscopy: fecal screening, binary review, and localized multi-class findings for licensed clinicians.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
