import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/charts/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import { Outfit, Public_Sans } from "next/font/google";
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { theme } from "@/theme";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });

export const metadata: Metadata = {
  title: "Payer Onboarding Demo · Prior Auth on GwenOS",
  description: "Synthetic-data demo of onboarding a payer: ingest, validate, resolve, and run prior authorization with an audit trail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${publicSans.variable}`} {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript forceColorScheme="light" />
      </head>
      <body>
        <MantineProvider theme={theme} forceColorScheme="light">
          <Notifications position="top-right" />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
