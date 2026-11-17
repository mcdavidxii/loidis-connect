import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loidis Connect - Rota planner",
  description: "Rota planner for Loidis Care Services",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
