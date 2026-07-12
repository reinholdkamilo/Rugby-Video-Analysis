import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rugby Video Analysis",
  description: "Professional rugby video analysis and coaching reports.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
