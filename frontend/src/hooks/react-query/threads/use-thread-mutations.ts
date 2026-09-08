'use client';

import { createMutationHook } from '@/hooks/use-query';
import {
  createThread,
  addUserMessage
} from '@/lib/api';
import type { ReferenceImageInput } from '@/lib/reference-images';
import { toast } from 'sonner';

export const useCreateThread = createMutationHook(
  ({ projectId }: { projectId: string }) => createThread(projectId),
  {
    onSuccess: () => {
      toast.success('Thread created successfully');
    },
    errorContext: {
      operation: 'create thread',
      resource: 'thread'
    }
  }
);

export const useAddUserMessage = createMutationHook(
  ({
    threadId,
    content,
    context,
    referenceImages,
    attachments,
  }: {
    threadId: string;
    content: string;
    context?: any;
    referenceImages?: ReferenceImageInput[];
    attachments?: import('@/lib/api').MessageAttachmentInput[];
  }) =>
    addUserMessage(threadId, content, context, referenceImages, attachments),
  {
    errorContext: {
      operation: 'add message',
      resource: 'message'
    }
  }
); 
