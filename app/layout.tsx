import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scorekeeper",
  description: "A simple scoresheet for game night.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<footer className="site-footer"><a href="/">Scorekeeper</a><a href="/privacy">Privacy</a><a href="/support">Support</a></footer></body>
    </html>
  );
}
