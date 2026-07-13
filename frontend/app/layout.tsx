import type { Metadata } from "next";
import { AppNav } from "@/components/app-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rugby Video Analysis",
  description: "Professional rugby video analysis and coaching reports.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white">
        <AppNav />
        {children}
      </body>
    </html>
  );
}
