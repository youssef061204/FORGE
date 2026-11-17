import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FORGE",
  description: "When an AI assistant needs a tool it doesn't have, FORGE builds it — locally, tested, and only with your approval.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
