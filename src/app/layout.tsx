import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getGoogleFontsUrl } from "@/lib/fonts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ad Studio Light - 広告CR分析＆生成スタジオ",
  description: "Meta広告の結果から勝ちパターンを抽出し、勝ちCRを分析して新しいクリエイティブを生成するローカル完結ツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontsUrl = getGoogleFontsUrl();

  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={fontsUrl} rel="stylesheet" />
      </head>
      <body className={`${geistSans.variable} antialiased bg-white text-gray-900`}>
        {children}
      </body>
    </html>
  );
}
