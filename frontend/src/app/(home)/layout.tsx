import { Navbar } from '@/components/home/sections/navbar';

export default function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="w-full relative">
      <div className="hidden md:block w-px h-full border-l border-border fixed top-0 left-6 z-10" />
      <div className="hidden md:block w-px h-full border-r border-border fixed top-0 right-6 z-10" />
      <Navbar />
      {children}
    </div>
  );
}
