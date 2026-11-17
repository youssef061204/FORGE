import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./application.css";
import { ForgeProductRoot } from "@/components/forge-product";
import "./product.css";
const sans = localFont({
  src: "../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  variable: "--font-dm",
  display: "swap",
});
const display = localFont({
  src: "../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  variable: "--font-space",
  display: "swap",
});
export const metadata: Metadata = {
  title: "FORGE — Software that earns the right to act.",
  description:
    "Create software at the moment of need. FORGE separates generation from admission through sandboxing, replay, exact permissions and human approval.",
  icons: { icon: "/forge-mark.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <ForgeProductRoot>{children}</ForgeProductRoot>
      </body>
    </html>
  );
}
