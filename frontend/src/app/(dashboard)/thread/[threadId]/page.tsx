import { redirect } from 'next/navigation';

interface ThreadPageProps {
  params: Promise<{ threadId: string }>;
}

export default async function ThreadPageRoute({ params }: ThreadPageProps) {
  const { threadId } = await params;

  // Thread page has been removed in simplified system
  redirect('/');
}