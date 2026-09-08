import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { addUserMessage, getMessages } from "@/lib/api";
import type { ReferenceImageInput } from "@/lib/reference-images";

export const useMessagesQuery = (threadId: string) =>
  createQueryHook(
    threadKeys.messages(threadId),
    () => getMessages(threadId),
    {
      enabled: !!threadId,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }
  )();

export const useAddUserMessageMutation = () =>
  createMutationHook(
    ({
      threadId,
      message,
      context,
      referenceImages,
      attachments,
      ctaAction,
      ctaPayload,
      ctaLabel,
    }: {
      threadId: string;
      message: string;
      context?: any;
      referenceImages?: ReferenceImageInput[];
      attachments?: import('@/lib/api').MessageAttachmentInput[];
      ctaAction?: string;
      ctaPayload?: any;
      ctaLabel?: string;
    }) =>
      addUserMessage(
        threadId,
        message,
        context,
        referenceImages,
        attachments,
        ctaAction,
        ctaPayload,
        ctaLabel,
      )
  )();
