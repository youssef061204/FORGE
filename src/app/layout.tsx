import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { Shell } from "@/ui/shell";

export const metadata: Metadata = {
  title: { default: "FORGE — builds the tool your assistant is missing", template: "%s · FORGE" },
  description: "AI assistants can only use the tools they've been given. FORGE builds the missing tool while you watch, and nothing runs until you approve it.",
};

export const viewport: Viewport = { themeColor: "#0c0a09", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = process.env.FORGE_MODE === "showcase" ? "showcase" : "local";
  return (
    <html lang="en">
      <body>
        <Shell mode={mode}>{children}</Shell>
      </body>
    </html>
  );
}
