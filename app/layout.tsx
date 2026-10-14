import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BSR 滑雪装备租赁与维护管理系统",
  description: "BSR 多门店租赁、跨店归还、维修协同与经营分析平台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
