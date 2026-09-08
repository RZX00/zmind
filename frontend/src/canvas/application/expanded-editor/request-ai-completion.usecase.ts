import type { NovelAiRequest } from '@/components/editor/novel';

export interface ExpandedEditorAiGateway {
  generate(request: NovelAiRequest): Promise<string>;
}

export async function requestExpandedEditorAiCompletionUseCase(
  gateway: ExpandedEditorAiGateway,
  request: NovelAiRequest,
): Promise<string> {
  const response = await gateway.generate(request);
  return response || '';
}
