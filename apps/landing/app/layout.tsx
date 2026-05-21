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
        <AnalyticsBootstrap />
        {children}
      </body>
    </html>
  );
}
