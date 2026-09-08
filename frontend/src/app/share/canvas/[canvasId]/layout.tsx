import { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ canvasId: string }> }): Promise<Metadata> {
  const { canvasId } = await params;
  const fallbackMeta: Metadata = {
    title: 'Shared Canvas | Zmind',
    description: 'View this shared canvas and its AI timeline on Zmind',
    alternates: { canonical: `${process.env.NEXT_PUBLIC_URL}/share/canvas/${canvasId}` },
    openGraph: {
      title: 'Shared Canvas | Zmind',
      description: 'View this shared canvas and its AI timeline on Zmind',
      images: [`${process.env.NEXT_PUBLIC_URL}/share-page/og-fallback.png`],
    },
  };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('canvases').select('title, is_listed').eq('id', canvasId).limit(1);
    if (error || !data || !Array.isArray(data) || data.length === 0) return fallbackMeta;
    const row = data[0];
    const title = row?.title ? `${row.title} | Zmind` : 'Shared Canvas | Zmind';
    const isListed = !!(row as any)?.is_listed;
    return {
      title,
      description: 'View this shared canvas and its AI timeline on Zmind',
      alternates: { canonical: `${process.env.NEXT_PUBLIC_URL}/share/canvas/${canvasId}` },
      openGraph: {
        title,
        description: 'View this shared canvas and its AI timeline on Zmind',
        images: [`${process.env.NEXT_PUBLIC_URL}/share-page/og-fallback.png`],
      },
      robots: isListed ? { index: true, follow: true } : { index: false, follow: false },
      twitter: {
        title,
        description: 'View this shared canvas and its AI timeline on Zmind',
        images: `${process.env.NEXT_PUBLIC_URL}/share-page/og-fallback.png`,
        card: 'summary_large_image',
      },
    };
  } catch {
    return fallbackMeta;
  }
}

export default function CanvasShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
