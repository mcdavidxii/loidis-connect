import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loidis Connect - Rota engine test",
  description: "Test screens for the Loidis Connect rota engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
