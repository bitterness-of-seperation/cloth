import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AuthProvider } from "@/components/layout/auth-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "虚拟试穿 - AI 智能穿搭体验",
  description: "上传照片或使用 AR 实时预览服装穿着效果",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
      >
        <AuthProvider>
          <Navbar />
          <main className="container mx-auto px-4 py-6 pb-20 md:pb-6">
            {children}
          </main>
          <MobileNav />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
