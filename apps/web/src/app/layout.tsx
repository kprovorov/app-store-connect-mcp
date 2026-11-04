import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "App Store Connect MCP";
const description =
  "A hosted MCP server that lets your AI agent check builds, answer customer reviews, manage TestFlight, and edit App Store Connect listing metadata.";
const images = [
  {
    url: "/social-image.png",
    width: 1200,
    height: 630,
    alt: "App Store Connect MCP. Let your AI agent work in App Store Connect. Builds, customer reviews, TestFlight, and version metadata.",
  },
];

export const metadata: Metadata = {
  metadataBase: new URL("https://app.ascmcp.dev"),
  applicationName: title,
  title,
  description,
  alternates: {
    canonical: "/",
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: title,
    title,
    description,
    images,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          taskUrls={{ "choose-organization": "/choose-organization" }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
