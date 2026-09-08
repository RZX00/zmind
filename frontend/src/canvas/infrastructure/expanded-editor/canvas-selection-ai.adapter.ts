import type { NovelAiRequest } from '@/components/editor/novel';
import { streamCanvasSelectionChat } from '@/lib/api';
import type { ExpandedEditorAiGateway } from '../../application/expanded-editor/request-ai-completion.usecase';

const DEFAULT_EXPANDED_EDITOR_MODEL = 'gemini-3-flash';

const OPTION_PROMPTS: Record<string, string> = {
  zap: 'Rewrite or generate text based on the instruction.',
  improve: 'Improve clarity, logic, and readability while preserving intent.',
  fix: 'Fix grammar and wording while preserving meaning.',
  shorter: 'Rewrite this to be shorter and more concise.',
  longer: 'Expand this with more details and stronger structure.',
  continue: 'Continue writing in the same tone and context.',
};

function buildPrompt(request: NovelAiRequest): string {
  const instruction = OPTION_PROMPTS[request.option] || OPTION_PROMPTS.zap;
  const command = request.command?.trim();
  if (!command) return instruction;
  return `${instruction}\n\nAdditional instruction:\n${command}`;
}

export class CanvasSelectionAiAdapter implements ExpandedEditorAiGateway {
  constructor(
    private readonly canvasId: string,
    private readonly modelName: string = DEFAULT_EXPANDED_EDITOR_MODEL,
  ) {}

  async generate(request: NovelAiRequest): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      let output = '';
      const stop = streamCanvasSelectionChat(
        this.canvasId,
        {
          prompt: buildPrompt(request),
          selection_markdown: request.selectionMarkdown || undefined,
          model_name: this.modelName,
        },
        {
          onChunk: (chunk) => {
            output += chunk;
          },
          onDone: () => {
            resolve(output.trim());
          },
          onError: (error) => {
            try {
              stop();
            } catch {}
            reject(error instanceof Error ? error : new Error(String(error || 'AI stream failed')));
          },
        },
      );
    });
  }
}
