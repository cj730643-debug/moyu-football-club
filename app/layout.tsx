import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '摸鱼足球俱乐部 · 你的球队故事', description: '免注册单人模式，或用用户名和密码与好友联机。原创球员、选秀与培养、完整2D比赛。' };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="zh-CN"><body>{children}</body></html>; }
