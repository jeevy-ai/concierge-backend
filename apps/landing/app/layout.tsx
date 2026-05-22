import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AnalyticsBootstrap } from "./_components/AnalyticsBootstrap";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Jeevy — Your AI Concierge",
  description:
    "Personalized AI concierge for your calendar and inbox. Tell us about your workflow in 5 quick questions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <a
          href="#hero"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-white focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>
        <AnalyticsBootstrap />
        {children}
      </body>
    </html>
  );
}
