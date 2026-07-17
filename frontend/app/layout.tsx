import type { Metadata, Viewport } from "next";
import { AppDesignStudio } from "@/components/app-design-studio";
import { AppNav } from "@/components/app-nav";
import "./globals.css";
import "./tab-pages.css";

export const metadata: Metadata = {
  title: {
    default: "Rugby Video Analysis",
    template: "%s · Rugby Video Analysis",
  },
  description: "Professional rugby video analysis, match coding and performance intelligence.",
};

export const viewport: Viewport = {
  themeColor: "#f4f7f5",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppNav />
        {children}
        <AppDesignStudio />
      </body>
    </html>
  );
}
