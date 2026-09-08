'use client';

import React from 'react';
import { ThreadComponent } from '@/components/thread/ThreadComponent';

// Next.js App Router passes params as a Promise in Client Components.
// Unwrap it using React.use(params) to avoid sync access warnings now and in future versions.
export default function ThreadPage({
  params,
}: {
  params: Promise<{
    projectId: string;
    threadId: string;
  }>;
}) {
  const { projectId, threadId } = React.use(params);
  return <ThreadComponent projectId={projectId} threadId={threadId} />;
}
