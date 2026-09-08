'use client';

import 'tippy.js/dist/tippy.css';
import 'katex/dist/katex.min.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { marked } from 'marked';
import Markdown from 'react-markdown';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { cn } from '@/lib/utils';
import { isMermaidCode } from '@/lib/mermaid-utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import { toast } from 'sonner';
import {
  ArrowUp,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquarePlus,
  Quote,
  Sigma,
  Sparkles,
  StepForward,
  Strikethrough,
  Text,
  TextQuote,
  Trash2,
  Twitter,
  Underline,
  Youtube,
} from 'lucide-react';
import {
  Command as SlashCommandExtension,
  EditorBubble,
  EditorBubbleItem,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorContent,
  EditorRoot,
  ImageResizer,
  addAIHighlight,
  createImageUpload,
  createSuggestionItems,
  getPrevText,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  removeAIHighlight,
  renderItems,
  useEditor,
  type EditorInstance,
} from 'novel';
import { createNovelExtensions } from './extensions';
import type {
  NovelAiOption,
  NovelAiRequest,
  NovelEditorContentSeed,
  NovelEditorSnapshot,
} from './types';

export interface NovelRichTextEditorProps {
  contentKey?: string;
  initialContent?: NovelEditorContentSeed;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  onEditorReady?: (editor: EditorInstance | null) => void;
  onChange?: (snapshot: NovelEditorSnapshot) => void;
  onBlur?: (snapshot: NovelEditorSnapshot) => void;
  onUploadImage?: (file: File) => Promise<string>;
  onAiGenerate?: (request: NovelAiRequest) => Promise<string>;
  onSaveHotkey?: () => void;
  mode?: 'default' | 'canvas-inline';
  showStats?: boolean;
  disableDragHandle?: boolean;
  inlineTypography?: {
    fontSize?: number;
    lineHeight?: number;
    fontFamily?: string;
    fontWeight?: string | number;
    color?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    letterSpacing?: string;
  };
  bubbleAppendToBody?: boolean;
}

type MermaidRenderResult = {
  svg: string;
  bindFunctions?: (element: Element) => void;
};

type MermaidRuntime = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<MermaidRenderResult>;
};

type SlashCommandRange = { from: number; to: number };
type EmbedType = 'youtube' | 'twitter';
type EmbedDialogState = {
  open: boolean;
  type: EmbedType;
  url: string;
  error: string;
};

const YOUTUBE_URL_REGEX = new RegExp(
  /^((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/,
);
const TWITTER_URL_REGEX = new RegExp(
  /^https?:\/\/(www\.)?x\.com\/([a-zA-Z0-9_]{1,15})(\/status\/(\d+))?(\/\S*)?$/,
);

const NOVEL_MENU_PANEL_CLASS =
  'border border-[var(--novel-menu-border)] bg-[var(--novel-menu-bg)] text-[var(--novel-menu-fg)] shadow-[var(--novel-menu-shadow)] backdrop-blur-md';
const NOVEL_MENU_ITEM_CLASS =
  'text-[var(--novel-menu-fg)] transition-colors hover:bg-[var(--novel-menu-hover)] hover:text-[var(--novel-menu-fg)] aria-selected:bg-[var(--novel-menu-hover)] aria-selected:text-[var(--novel-menu-fg)]';

const TEXT_COLOR_ITEMS = [
  { name: 'Default', color: '#111827' },
  { name: 'Purple', color: '#7C3AED' },
  { name: 'Red', color: '#DC2626' },
  { name: 'Yellow', color: '#CA8A04' },
  { name: 'Blue', color: '#2563EB' },
  { name: 'Green', color: '#16A34A' },
  { name: 'Orange', color: '#EA580C' },
  { name: 'Pink', color: '#DB2777' },
  { name: 'Gray', color: '#6B7280' },
] as const;

const HIGHLIGHT_COLOR_ITEMS = [
  { name: 'Default', color: '#FFFFFF' },
  { name: 'Purple', color: '#F3E8FF' },
  { name: 'Red', color: '#FEE2E2' },
  { name: 'Yellow', color: '#FEF9C3' },
  { name: 'Blue', color: '#DBEAFE' },
  { name: 'Green', color: '#DCFCE7' },
  { name: 'Orange', color: '#FFEDD5' },
  { name: 'Pink', color: '#FCE7F3' },
  { name: 'Gray', color: '#F3F4F6' },
] as const;

type SelectorItem = {
  name: string;
  icon: ComponentType<{ className?: string }>;
  command: (editor: EditorInstance) => void;
  isActive: (editor: EditorInstance) => boolean;
};

const NODE_SELECTOR_ITEMS: SelectorItem[] = [
  {
    name: 'Text',
    icon: Quote,
    command: (editor) => editor.chain().focus().clearNodes().run(),
    isActive: (editor) =>
      editor.isActive('paragraph') && !editor.isActive('bulletList') && !editor.isActive('orderedList'),
  },
  {
    name: 'Heading 1',
    icon: Heading1,
    command: (editor) => editor.chain().focus().clearNodes().toggleHeading({ level: 1 }).run(),
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
  },
  {
    name: 'Heading 2',
    icon: Heading2,
    command: (editor) => editor.chain().focus().clearNodes().toggleHeading({ level: 2 }).run(),
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
  },
  {
    name: 'Heading 3',
    icon: Heading3,
    command: (editor) => editor.chain().focus().clearNodes().toggleHeading({ level: 3 }).run(),
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
  },
  {
    name: 'To-do',
    icon: CheckSquare,
    command: (editor) => editor.chain().focus().clearNodes().toggleTaskList().run(),
    isActive: (editor) => editor.isActive('taskItem'),
  },
  {
    name: 'Bullet List',
    icon: List,
    command: (editor) => editor.chain().focus().clearNodes().toggleBulletList().run(),
    isActive: (editor) => editor.isActive('bulletList'),
  },
  {
    name: 'Numbered List',
    icon: ListOrdered,
    command: (editor) => editor.chain().focus().clearNodes().toggleOrderedList().run(),
    isActive: (editor) => editor.isActive('orderedList'),
  },
  {
    name: 'Quote',
    icon: Quote,
    command: (editor) => editor.chain().focus().clearNodes().toggleBlockquote().run(),
    isActive: (editor) => editor.isActive('blockquote'),
  },
  {
    name: 'Code',
    icon: Code,
    command: (editor) => editor.chain().focus().clearNodes().toggleCodeBlock().run(),
    isActive: (editor) => editor.isActive('codeBlock'),
  },
];

const AI_OPTION_ITEMS: Array<{ option: NovelAiOption; label: string; hint: string; icon: ReactNode }> = [
  {
    option: 'improve',
    label: 'Improve writing',
    hint: 'Improve clarity and readability',
    icon: <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  },
  {
    option: 'fix',
    label: 'Fix grammar',
    hint: 'Correct grammar and wording',
    icon: <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  },
  {
    option: 'shorter',
    label: 'Make shorter',
    hint: 'Keep meaning, reduce length',
    icon: <Quote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  },
  {
    option: 'longer',
    label: 'Make longer',
    hint: 'Add detail and depth',
    icon: <List className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  },
];

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});
turndownService.use(gfm);

function computeWordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function toMarkdown(editor: EditorInstance): string {
  const markdownFromStorage = (editor as any)?.storage?.markdown?.getMarkdown?.();
  if (typeof markdownFromStorage === 'string') {
    return markdownFromStorage;
  }
  const html = editor.getHTML() || '';
  try {
    return turndownService.turndown(html);
  } catch {
    return editor.getText();
  }
}

function getSelectionMarkdown(editor: EditorInstance): string {
  try {
    const selection = editor.state.selection.content();
    const markdownSerializer = (editor as any)?.storage?.markdown?.serializer;
    if (markdownSerializer?.serialize) {
      return markdownSerializer.serialize(selection.content);
    }
  } catch {}
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '\n');
}

function buildSnapshot(editor: EditorInstance): NovelEditorSnapshot {
  const markdown = toMarkdown(editor);
  const plainText = editor.getText() || '';
  const characterCount =
    (editor as any)?.storage?.characterCount?.characters?.() ?? plainText.length;
  const wordCount =
    (editor as any)?.storage?.characterCount?.words?.() ?? computeWordCount(plainText);

  return {
    markdown,
    html: editor.getHTML(),
    json: editor.getJSON(),
    wordCount,
    characterCount,
  };
}

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

function getCodeBlockLanguage(codeElement: HTMLElement): string {
  const className = codeElement.className || '';
  const match = /language-([a-z0-9_-]+)/i.exec(className);
  return match?.[1]?.toLowerCase() || '';
}

function getDirectChildByClass<T extends HTMLElement>(parent: HTMLElement, className: string): T | null {
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.classList.contains(className)) {
      return child as T;
    }
  }
  return null;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('clipboard_write_failed');
  }
}

function resolveInitialSeed(seed?: NovelEditorContentSeed) {
  const rawJson = seed?.json;
  const hasJson = !!(rawJson && typeof rawJson === 'object');
  const initialJson = hasJson ? rawJson : undefined;
  let bootstrapHtml = '';

  if (!initialJson && seed?.html) {
    bootstrapHtml = seed.html;
  } else if (!initialJson && seed?.markdown) {
    try {
      bootstrapHtml = String(marked.parse(seed.markdown));
    } catch {
      bootstrapHtml = seed.markdown;
    }
  }

  return { initialJson, bootstrapHtml };
}

function getUploadValidator(file: File) {
  if (!file.type.includes('image/')) {
    toast.error('Only image files are supported');
    return false;
  }
  if (file.size / 1024 / 1024 > 20) {
    toast.error('Image is too large (max 20MB)');
    return false;
  }
  return true;
}

function createUploadHandler(onUploadImage?: (file: File) => Promise<string>) {
  return createImageUpload({
    validateFn: getUploadValidator,
    onUpload: async (file) => {
      if (!onUploadImage) {
        return URL.createObjectURL(file);
      }
      const toastId = toast.loading('Uploading image...');
      try {
        const uploadedUrl = await onUploadImage(file);
        toast.success('Image uploaded', { id: toastId });
        return uploadedUrl;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Image upload failed', { id: toastId });
        throw error;
      }
    },
  });
}

function createSlashSuggestionItems(
  uploadFn: ReturnType<typeof createUploadHandler>,
  onRequestEmbed: (type: EmbedType, editor: EditorInstance, range: SlashCommandRange) => void,
  onRequestAi?: (editor: EditorInstance, range: SlashCommandRange) => void,
) {
  const items = [
    {
      title: 'Send Feedback',
      description: 'Let us know how we can improve.',
      icon: <MessageSquarePlus size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        window.open('/feedback', '_blank');
      },
    },
    {
      title: 'Text',
      description: 'Just start typing with plain text.',
      searchTerms: ['p', 'paragraph'],
      icon: <Text size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleNode('paragraph', 'paragraph').run();
      },
    },
    {
      title: 'To-do List',
      description: 'Track tasks with a to-do list.',
      searchTerms: ['todo', 'task', 'list', 'check', 'checkbox'],
      icon: <CheckSquare size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
      title: 'Heading 1',
      description: 'Big section heading.',
      searchTerms: ['title', 'big', 'large'],
      icon: <Heading1 size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
      },
    },
    {
      title: 'Heading 2',
      description: 'Medium section heading.',
      searchTerms: ['subtitle', 'medium'],
      icon: <Heading2 size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
      },
    },
    {
      title: 'Heading 3',
      description: 'Small section heading.',
      searchTerms: ['subtitle', 'small'],
      icon: <Heading3 size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
      },
    },
    {
      title: 'Bullet List',
      description: 'Create a simple bullet list.',
      searchTerms: ['unordered', 'point'],
      icon: <List size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: 'Numbered List',
      description: 'Create a list with numbering.',
      searchTerms: ['ordered'],
      icon: <ListOrdered size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: 'Quote',
      description: 'Capture a quote.',
      searchTerms: ['blockquote'],
      icon: <TextQuote size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleNode('paragraph', 'paragraph').toggleBlockquote().run();
      },
    },
    {
      title: 'Code',
      description: 'Capture a code snippet.',
      searchTerms: ['codeblock'],
      icon: <Code size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
      },
    },
    {
      title: 'Image',
      description: 'Upload an image from your computer.',
      searchTerms: ['photo', 'picture', 'media'],
      icon: <ImageIcon size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          if (!input.files?.length) return;
          const file = input.files[0];
          const pos = editor.view.state.selection.from;
          uploadFn(file, editor.view, pos);
        };
        input.click();
      },
    },
    {
      title: 'Youtube',
      description: 'Embed a Youtube video.',
      searchTerms: ['video', 'youtube', 'embed'],
      icon: <Youtube size={18} />,
      command: ({ editor, range }) => {
        onRequestEmbed('youtube', editor, range);
      },
    },
    {
      title: 'Twitter',
      description: 'Embed a Tweet.',
      searchTerms: ['twitter', 'embed'],
      icon: <Twitter size={18} />,
      command: ({ editor, range }) => {
        onRequestEmbed('twitter', editor, range);
      },
    },
  ];

  if (onRequestAi) {
    items.splice(1, 0, {
      title: 'Ask AI',
      description: 'Generate or rewrite content with AI.',
      searchTerms: ['ai', 'rewrite', 'improve', 'generate'],
      icon: <Sparkles size={18} />,
      command: ({ editor, range }) => {
        onRequestAi(editor, range);
      },
    });
  }

  return createSuggestionItems(items);
}

export function NovelRichTextEditor({
  contentKey,
  initialContent,
  className,
  placeholder,
  autoFocus = false,
  readOnly = false,
  onEditorReady,
  onChange,
  onBlur,
  onUploadImage,
  onAiGenerate,
  onSaveHotkey,
  mode = 'default',
  showStats = true,
  disableDragHandle = false,
  inlineTypography,
  bubbleAppendToBody,
}: NovelRichTextEditorProps) {
  const isCanvasInline = mode === 'canvas-inline';
  const useBodyFloatingUi = bubbleAppendToBody ?? isCanvasInline;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const transactionListenerCleanupRef = useRef<(() => void) | null>(null);
  const copyStateResetTimersRef = useRef(new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>());
  const mermaidRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mermaidRenderTokenRef = useRef(0);
  const mermaidRuntimeRef = useRef<MermaidRuntime | null>(null);
  const mermaidRuntimeLoadRef = useRef<Promise<MermaidRuntime> | null>(null);
  const mermaidThemeRef = useRef<string | null>(null);
  const [openNode, setOpenNode] = useState(false);
  const [openColor, setOpenColor] = useState(false);
  const [openLink, setOpenLink] = useState(false);
  const [openAI, setOpenAI] = useState(false);
  const [stats, setStats] = useState({ wordCount: 0, characterCount: 0 });
  const aiTriggerAtRef = useRef(0);
  const pendingEmbedRef = useRef<{
    type: EmbedType;
    editor: EditorInstance;
    range: SlashCommandRange;
  } | null>(null);
  const [embedDialog, setEmbedDialog] = useState<EmbedDialogState | null>(null);

  const openEmbedDialog = useCallback((type: EmbedType, editor: EditorInstance, range: SlashCommandRange) => {
    pendingEmbedRef.current = { type, editor, range };
    setEmbedDialog({
      open: true,
      type,
      url: '',
      error: '',
    });
  }, []);

  const closeEmbedDialog = useCallback(() => {
    pendingEmbedRef.current = null;
    setEmbedDialog(null);
  }, []);

  const uploadFn = useMemo(() => createUploadHandler(onUploadImage), [onUploadImage]);
  const openAiFromSlash = useCallback((editor: EditorInstance, range: SlashCommandRange) => {
    if (!onAiGenerate) return;
    editor.chain().focus().deleteRange(range).run();
    addAIHighlight(editor);
    setOpenAI(true);
  }, [onAiGenerate]);
  const suggestionItems = useMemo(
    () => createSlashSuggestionItems(
      uploadFn,
      openEmbedDialog,
      onAiGenerate ? openAiFromSlash : undefined,
    ),
    [uploadFn, openEmbedDialog, onAiGenerate, openAiFromSlash],
  );
  const slashCommand = useMemo(
    () =>
      SlashCommandExtension.configure({
        suggestion: {
          items: () => suggestionItems,
          render: renderItems,
        },
      }),
    [suggestionItems],
  );
  const extensions = useMemo(
    () => [
      ...createNovelExtensions(placeholder, {
        enableGlobalDragHandle: !disableDragHandle,
      }),
      slashCommand,
    ],
    [placeholder, disableDragHandle, slashCommand],
  );
  const { initialJson, bootstrapHtml } = useMemo(
    () => resolveInitialSeed(initialContent),
    [initialContent],
  );
  const inlineTypographyStyle = useMemo(() => {
    if (!isCanvasInline) return undefined;
    const rules: string[] = [];
    if (typeof inlineTypography?.fontSize === 'number') {
      rules.push(`--canvas-inline-font-size:${inlineTypography.fontSize}px`);
    }
    if (typeof inlineTypography?.lineHeight === 'number') {
      rules.push(`--canvas-inline-line-height:${inlineTypography.lineHeight}`);
    }
    if (inlineTypography?.fontFamily) {
      rules.push(`--canvas-inline-font-family:${inlineTypography.fontFamily}`);
    }
    if (inlineTypography?.fontWeight !== undefined) {
      rules.push(`--canvas-inline-font-weight:${inlineTypography.fontWeight}`);
    }
    if (inlineTypography?.color) {
      rules.push(`--canvas-inline-color:${inlineTypography.color}`);
    }
    if (inlineTypography?.textAlign) {
      rules.push(`--canvas-inline-text-align:${inlineTypography.textAlign}`);
    }
    if (inlineTypography?.letterSpacing) {
      rules.push(`--canvas-inline-letter-spacing:${inlineTypography.letterSpacing}`);
    }
    return rules.length > 0 ? rules.join(';') : undefined;
  }, [isCanvasInline, inlineTypography]);

  const refreshStatsFromEditor = useCallback((editor: EditorInstance) => {
    const plainText = editor.getText() || '';
    const characterCount =
      (editor as any)?.storage?.characterCount?.characters?.() ?? plainText.length;
    const wordCount =
      (editor as any)?.storage?.characterCount?.words?.() ?? computeWordCount(plainText);
    setStats({ wordCount, characterCount });
  }, []);

  const ensureCodeBlockCopyState = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const blocks = shell.querySelectorAll<HTMLPreElement>('.novel-editor-content pre');
    blocks.forEach((pre) => {
      let copyButton = getDirectChildByClass<HTMLButtonElement>(pre, 'novel-code-copy-btn');
      if (!copyButton) {
        copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'novel-code-copy-btn';
        copyButton.setAttribute('contenteditable', 'false');
        copyButton.setAttribute('aria-label', 'Copy code block');
        copyButton.tabIndex = -1;
        pre.appendChild(copyButton);
      }
      if (!copyButton.dataset.state) {
        copyButton.dataset.state = 'idle';
      }
      if (!copyButton.textContent) {
        copyButton.textContent = 'Copy';
      }
    });
  }, []);

  const ensureMermaidRuntime = useCallback(async (): Promise<MermaidRuntime> => {
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'default';

    if (!mermaidRuntimeRef.current) {
      if (!mermaidRuntimeLoadRef.current) {
        mermaidRuntimeLoadRef.current = import('mermaid')
          .then((module) => {
            const runtime = module.default as unknown as MermaidRuntime;
            mermaidRuntimeRef.current = runtime;
            return runtime;
          })
          .finally(() => {
            mermaidRuntimeLoadRef.current = null;
          });
      }
      mermaidRuntimeRef.current = await mermaidRuntimeLoadRef.current;
    }

    if (mermaidThemeRef.current !== theme) {
      mermaidRuntimeRef.current.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        suppressErrorRendering: true,
        theme,
      });
      mermaidThemeRef.current = theme;
    }

    return mermaidRuntimeRef.current;
  }, []);

  const cleanupStaleMermaidPreviews = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const blocks = shell.querySelectorAll<HTMLPreElement>('.novel-editor-content pre');
    blocks.forEach((pre) => {
      const codeElement = pre.querySelector('code');
      if (!(codeElement instanceof HTMLElement)) {
        const preview = getDirectChildByClass<HTMLDivElement>(pre, 'novel-mermaid-preview');
        preview?.remove();
        pre.dataset.mermaidSource = 'false';
        return;
      }
      const rawCode = (codeElement.textContent || '').replace(/\u00A0/g, ' ');
      const language = getCodeBlockLanguage(codeElement);
      const isMermaid = isMermaidCode(language, rawCode);
      if (!isMermaid) {
        const preview = getDirectChildByClass<HTMLDivElement>(pre, 'novel-mermaid-preview');
        preview?.remove();
        pre.dataset.mermaidSource = 'false';
      }
    });
  }, []);

  const renderMermaidPreviews = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;

    const renderToken = ++mermaidRenderTokenRef.current;
    const blocks = Array.from(shell.querySelectorAll<HTMLPreElement>('.novel-editor-content pre'));
    const mermaidBlocks = blocks
      .map((pre) => {
        const codeElement = pre.querySelector('code');
        if (!(codeElement instanceof HTMLElement)) {
          pre.dataset.mermaidSource = 'false';
          return null;
        }
        const rawCode = (codeElement.textContent || '').replace(/\u00A0/g, ' ');
        const language = getCodeBlockLanguage(codeElement);
        const isMermaid = isMermaidCode(language, rawCode);
        pre.dataset.mermaidSource = isMermaid ? 'true' : 'false';
        if (!isMermaid) {
          return null;
        }
        return {
          pre,
          source: rawCode.trim(),
        };
      })
      .filter((item): item is { pre: HTMLPreElement; source: string } => Boolean(item));

    if (mermaidBlocks.length === 0) {
      cleanupStaleMermaidPreviews();
      return;
    }

    const runtime = await ensureMermaidRuntime();
    if (renderToken !== mermaidRenderTokenRef.current) {
      return;
    }

    for (const [index, block] of mermaidBlocks.entries()) {
      if (renderToken !== mermaidRenderTokenRef.current) {
        return;
      }

      let preview = getDirectChildByClass<HTMLDivElement>(block.pre, 'novel-mermaid-preview');
      if (!preview) {
        preview = document.createElement('div');
        preview.className = 'novel-mermaid-preview';
        block.pre.appendChild(preview);
      }

      const themedSource = `${mermaidThemeRef.current || 'default'}::${block.source}`;
      const contentHash = hashContent(themedSource);
      if (preview.dataset.contentHash === contentHash && preview.dataset.renderState === 'ready') {
        continue;
      }

      preview.dataset.renderState = 'loading';
      preview.innerHTML = '<div class="novel-mermaid-preview__status">Rendering Mermaid diagram...</div>';

      try {
        const renderId = `novel-mermaid-${index}-${renderToken}`;
        const result = await runtime.render(renderId, block.source);
        if (renderToken !== mermaidRenderTokenRef.current) {
          return;
        }
        preview.innerHTML = result.svg;
        if (typeof result.bindFunctions === 'function') {
          result.bindFunctions(preview);
        }
        preview.dataset.renderState = 'ready';
        preview.dataset.contentHash = contentHash;
      } catch (error) {
        if (renderToken !== mermaidRenderTokenRef.current) {
          return;
        }
        const message = error instanceof Error && error.message
          ? error.message
          : 'Unable to render Mermaid diagram.';
        preview.dataset.renderState = 'error';
        preview.dataset.contentHash = contentHash;
        preview.innerHTML = '';
        const status = document.createElement('div');
        status.className = 'novel-mermaid-preview__status novel-mermaid-preview__status--error';
        status.textContent = `Mermaid: ${message}`;
        preview.appendChild(status);
      }
    }

    cleanupStaleMermaidPreviews();
  }, [cleanupStaleMermaidPreviews, ensureMermaidRuntime]);

  const scheduleMermaidPreviewRefresh = useCallback(() => {
    if (mermaidRefreshTimerRef.current) {
      clearTimeout(mermaidRefreshTimerRef.current);
    }
    mermaidRefreshTimerRef.current = setTimeout(() => {
      mermaidRefreshTimerRef.current = null;
      void renderMermaidPreviews();
    }, 90);
  }, [renderMermaidPreviews]);

  const emitSnapshot = useCallback(
    (editor: EditorInstance) => {
      const snapshot = buildSnapshot(editor);
      onChange?.(snapshot);
    },
    [onChange],
  );

  const maybeOpenAiByShortcut = useCallback(
    (editor: EditorInstance) => {
      if (!onAiGenerate) return;
      const now = Date.now();
      if (now - aiTriggerAtRef.current < 250) return;
      const cursor = editor.state.selection.from;
      if (cursor < 3) return;
      const prefix = editor.state.doc.textBetween(cursor - 2, cursor, '\n');
      if (prefix !== '++') return;
      aiTriggerAtRef.current = now;
      editor
        .chain()
        .focus()
        .deleteRange({ from: cursor - 2, to: cursor })
        .run();
      addAIHighlight(editor);
      setOpenAI(true);
    },
    [onAiGenerate],
  );

  useEffect(() => {
    return () => {
      if (transactionListenerCleanupRef.current) {
        transactionListenerCleanupRef.current();
        transactionListenerCleanupRef.current = null;
      }
      if (mermaidRefreshTimerRef.current) {
        clearTimeout(mermaidRefreshTimerRef.current);
        mermaidRefreshTimerRef.current = null;
      }
      mermaidRenderTokenRef.current += 1;
      copyStateResetTimersRef.current.forEach((timer) => {
        clearTimeout(timer);
      });
      copyStateResetTimersRef.current.clear();
      onEditorReady?.(null);
    };
  }, [onEditorReady]);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      scheduleMermaidPreviewRefresh();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [scheduleMermaidPreviewRefresh]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const getCodeBlockFromEvent = (event: Event): HTMLPreElement | null => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      const pre = target.closest('.novel-editor-content pre');
      if (!(pre instanceof HTMLPreElement)) return null;
      return pre;
    };

    const getCopyButtonFromEvent = (event: Event): HTMLButtonElement | null => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      const button = target.closest('.novel-code-copy-btn');
      if (!(button instanceof HTMLButtonElement)) return null;
      return button;
    };

    const resetCopyState = (copyButton: HTMLButtonElement) => {
      const existing = copyStateResetTimersRef.current.get(copyButton);
      if (existing) {
        clearTimeout(existing);
      }
      copyButton.textContent = 'Copied';
      copyButton.dataset.state = 'copied';
      const timer = setTimeout(() => {
        copyButton.textContent = 'Copy';
        copyButton.dataset.state = 'idle';
        copyStateResetTimersRef.current.delete(copyButton);
      }, 1300);
      copyStateResetTimersRef.current.set(copyButton, timer);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const copyButton = getCopyButtonFromEvent(event);
      if (!copyButton) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleClick = async (event: MouseEvent) => {
      const copyButton = getCopyButtonFromEvent(event);
      if (!copyButton) return;
      const pre = getCodeBlockFromEvent(event);
      if (!pre) return;
      event.preventDefault();
      event.stopPropagation();
      const code = pre.querySelector('code');
      const textToCopy = (code?.textContent || '').replace(/\u00A0/g, ' ');
      if (!textToCopy) return;
      try {
        await copyTextToClipboard(textToCopy);
        resetCopyState(copyButton);
      } catch {
        toast.error('Failed to copy code block');
      }
    };

    shell.addEventListener('pointerdown', handlePointerDown, true);
    shell.addEventListener('click', handleClick, true);

    return () => {
      shell.removeEventListener('pointerdown', handlePointerDown, true);
      shell.removeEventListener('click', handleClick, true);
      copyStateResetTimersRef.current.forEach((timer) => {
        clearTimeout(timer);
      });
      copyStateResetTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (disableDragHandle) return;
    const shell = shellRef.current;
    if (!shell) return;
    const frame = shell.querySelector('.novel-editor-frame');
    if (!(frame instanceof HTMLElement)) return;

    const hideDragHandles = () => {
      const handles = shell.querySelectorAll<HTMLElement>('.drag-handle');
      handles.forEach((handle) => handle.classList.add('hide'));
    };

    // Hide stale handles while content/viewport moves; plugin will show it again on mousemove.
    hideDragHandles();
    frame.addEventListener('scroll', hideDragHandles, { passive: true });
    frame.addEventListener('wheel', hideDragHandles, { passive: true });
    frame.addEventListener('touchmove', hideDragHandles, { passive: true });
    frame.addEventListener('keydown', hideDragHandles);
    frame.addEventListener('mousedown', hideDragHandles, true);

    return () => {
      frame.removeEventListener('scroll', hideDragHandles);
      frame.removeEventListener('wheel', hideDragHandles);
      frame.removeEventListener('touchmove', hideDragHandles);
      frame.removeEventListener('keydown', hideDragHandles);
      frame.removeEventListener('mousedown', hideDragHandles, true);
    };
  }, [disableDragHandle, contentKey, isCanvasInline]);

  const handleEmbedSubmit = useCallback(() => {
    const pendingEmbed = pendingEmbedRef.current;
    const currentDialog = embedDialog;
    if (!pendingEmbed || !currentDialog) return;

    const link = currentDialog.url.trim();
    if (!link) {
      setEmbedDialog((prev) => prev ? { ...prev, error: 'Please enter a link.' } : prev);
      return;
    }

    if (pendingEmbed.type === 'youtube') {
      if (!YOUTUBE_URL_REGEX.test(link)) {
        setEmbedDialog((prev) => prev ? { ...prev, error: 'Please enter a valid YouTube link.' } : prev);
        return;
      }
      pendingEmbed.editor.chain().focus().deleteRange(pendingEmbed.range).setYoutubeVideo({ src: link }).run();
      closeEmbedDialog();
      return;
    }

    if (!TWITTER_URL_REGEX.test(link)) {
      setEmbedDialog((prev) => prev ? { ...prev, error: 'Please enter a valid Twitter/X link.' } : prev);
      return;
    }
    pendingEmbed.editor.chain().focus().deleteRange(pendingEmbed.range).setTweet({ src: link }).run();
    closeEmbedDialog();
  }, [closeEmbedDialog, embedDialog]);

  return (
    <div ref={shellRef} className={cn('novel-editor-shell relative h-full w-full', className)}>
      {showStats && !isCanvasInline ? (
        <div className="pointer-events-none absolute bottom-4 right-6 z-20 select-none text-[11px] tracking-tight text-muted-foreground/75">
          {stats.wordCount} words · {stats.characterCount} chars
        </div>
      ) : null}
      <EditorRoot>
        <EditorContent
          key={contentKey || 'novel-editor'}
          initialContent={initialJson}
          extensions={extensions}
          autofocus={autoFocus}
          editable={!readOnly}
          className={cn(
            'novel-editor-frame h-full w-full text-foreground',
            isCanvasInline
              ? '!h-auto min-h-full overflow-visible rounded-none border-0 bg-transparent shadow-none'
              : 'overflow-y-auto overflow-x-hidden scrollbar-none rounded-2xl border border-border/70 bg-background/95 shadow-[0_10px_28px_rgba(15,23,42,0.09)] dark:shadow-[0_14px_32px_rgba(2,6,23,0.42)]',
          )}
          editorProps={{
            handleDOMEvents: {
              keydown: (_view, event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  onSaveHotkey?.();
                  return true;
                }
                return handleCommandNavigation(event);
              },
            },
            handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
            handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
            attributes: {
              class: isCanvasInline
                ? cn(
                    'tiptap novel-editor-content canvas-inline-content max-w-none text-foreground focus:outline-none',
                    'min-h-full h-auto px-0 py-0 pb-1',
                    readOnly && 'pointer-events-none',
                  )
                : cn(
                    'tiptap novel-editor-content prose prose-slate dark:prose-invert max-w-none text-foreground focus:outline-none prose-headings:scroll-m-20 prose-headings:font-semibold prose-strong:font-semibold prose-a:transition-colors',
                    'min-h-[420px] px-7 py-8 pb-16 md:px-11 md:py-10 md:pb-16',
                    readOnly && 'pointer-events-none',
                  ),
              ...(inlineTypographyStyle ? { style: inlineTypographyStyle } : {}),
            },
          }}
          onCreate={({ editor }) => {
            if (transactionListenerCleanupRef.current) {
              transactionListenerCleanupRef.current();
              transactionListenerCleanupRef.current = null;
            }
            onEditorReady?.(editor);
            const handleTransaction = () => {
              refreshStatsFromEditor(editor);
              ensureCodeBlockCopyState();
              scheduleMermaidPreviewRefresh();
            };
            editor.on('transaction', handleTransaction);
            transactionListenerCleanupRef.current = () => {
              editor.off('transaction', handleTransaction);
            };
            if (bootstrapHtml) {
              editor.commands.setContent(bootstrapHtml, false);
            }
            refreshStatsFromEditor(editor);
            ensureCodeBlockCopyState();
            scheduleMermaidPreviewRefresh();
            emitSnapshot(editor);
          }}
          onUpdate={({ editor }) => {
            emitSnapshot(editor);
            maybeOpenAiByShortcut(editor);
          }}
          onBlur={({ editor }) => {
            onBlur?.(buildSnapshot(editor));
          }}
          slotAfter={<ImageResizer />}
        >
          {!readOnly && (
            <>
              <EditorCommand
                className={cn(
                  'z-50 h-auto max-h-[330px] overflow-y-auto rounded-xl px-1 py-2 transition-all',
                  NOVEL_MENU_PANEL_CLASS,
                )}
              >
                <EditorCommandEmpty className="px-2 text-muted-foreground">No results</EditorCommandEmpty>
                <EditorCommandList>
                  {suggestionItems.map((item) => (
                    <EditorCommandItem
                      value={item.title}
                      onCommand={(val) => item.command(val)}
                      className={cn(
                        'flex w-full items-center space-x-2 rounded-lg px-2 py-1.5 text-left text-sm',
                        NOVEL_MENU_ITEM_CLASS,
                      )}
                      key={item.title}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border/70 bg-muted/35 text-muted-foreground">
                        {item.icon}
                      </div>
                      <div>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </div>
                    </EditorCommandItem>
                  ))}
                </EditorCommandList>
              </EditorCommand>

              <GenerativeMenuSwitch
                open={openAI}
                onOpenChange={setOpenAI}
                onAiGenerate={onAiGenerate}
                appendToBody={useBodyFloatingUi}
              >
                <Separator orientation="vertical" className="h-7" />
                <NodeSelector open={openNode} onOpenChange={setOpenNode} />
                <Separator orientation="vertical" className="h-7" />
                <LinkSelector open={openLink} onOpenChange={setOpenLink} />
                <Separator orientation="vertical" className="h-7" />
                <MathSelector />
                <Separator orientation="vertical" className="h-7" />
                <TextButtons />
                <Separator orientation="vertical" className="h-7" />
                <ColorSelector open={openColor} onOpenChange={setOpenColor} />
              </GenerativeMenuSwitch>
            </>
          )}
        </EditorContent>
      </EditorRoot>
      <Dialog open={embedDialog?.open ?? false} onOpenChange={(open) => { if (!open) closeEmbedDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {embedDialog?.type === 'youtube' ? 'Embed YouTube video' : 'Embed Tweet'}
            </DialogTitle>
            <DialogDescription>
              {embedDialog?.type === 'youtube'
                ? 'Paste a full YouTube URL to insert a playable video.'
                : 'Paste a Tweet URL from x.com to embed it.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="novel-embed-link-input">
              {embedDialog?.type === 'youtube' ? 'YouTube link' : 'Twitter/X link'}
            </Label>
            <Input
              id="novel-embed-link-input"
              value={embedDialog?.url || ''}
              onChange={(event) => {
                const value = event.target.value;
                setEmbedDialog((prev) => prev ? { ...prev, url: value, error: '' } : prev);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                handleEmbedSubmit();
              }}
              placeholder={embedDialog?.type === 'youtube' ? 'https://www.youtube.com/watch?v=...' : 'https://x.com/.../status/...'}
              autoFocus
            />
            {embedDialog?.error ? (
              <p className="text-xs text-destructive">{embedDialog.error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEmbedDialog}>
              Cancel
            </Button>
            <Button onClick={handleEmbedSubmit} disabled={!embedDialog?.url.trim()}>
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GenerativeMenuSwitch({
  children,
  open,
  onOpenChange,
  onAiGenerate,
  appendToBody = false,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAiGenerate?: (request: NovelAiRequest) => Promise<string>;
  appendToBody?: boolean;
}) {
  const { editor } = useEditor();

  useEffect(() => {
    if (!editor || open) return;
    removeAIHighlight(editor);
  }, [open, editor]);

  if (!editor) return null;

  const aiEnabled = typeof onAiGenerate === 'function';

  return (
    <EditorBubble
      tippyOptions={{
        placement: open ? 'bottom-start' : 'top',
        maxWidth: '450px',
        theme: 'novel',
        ...(appendToBody
          ? {
              appendTo: () => document.body,
              popperOptions: { strategy: 'fixed' as const },
            }
          : {}),
        onHidden: () => {
          onOpenChange(false);
          editor.chain().unsetHighlight().run();
        },
      }}
      className={cn('flex w-fit max-w-[92vw] overflow-hidden rounded-lg shadow-xl', NOVEL_MENU_PANEL_CLASS)}
    >
      {aiEnabled && open && (
        <AiSelector editor={editor} onOpenChange={onOpenChange} onAiGenerate={onAiGenerate!} />
      )}
      {!open && (
        <>
          {aiEnabled && (
            <Button
              className="gap-1 rounded-none border-none text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(true)}
            >
              <Sparkles className="h-4 w-4" />
              AI
            </Button>
          )}
          {children}
        </>
      )}
    </EditorBubble>
  );
}

function AiSelector({
  editor,
  onOpenChange,
  onAiGenerate,
}: {
  editor: EditorInstance;
  onOpenChange: (open: boolean) => void;
  onAiGenerate: (request: NovelAiRequest) => Promise<string>;
}) {
  const [inputValue, setInputValue] = useState('');
  const [completion, setCompletion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    option: NovelAiOption;
    selectionMarkdown: string;
    command?: string;
  } | null>(null);

  const hasCompletion = completion.trim().length > 0;

  const runAi = useCallback(
    async (option: NovelAiOption, selectionMarkdown: string, command?: string) => {
      setErrorMessage(null);
      setIsLoading(true);
      try {
        const result = await onAiGenerate({
          selectionMarkdown,
          option,
          command: command?.trim() || undefined,
          previousCompletion: completion || undefined,
        });
        setCompletion(result || '');
        setLastFailedRequest(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI request failed';
        setErrorMessage(message);
        setLastFailedRequest({
          option,
          selectionMarkdown,
          command: command?.trim() || undefined,
        });
        toast.error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [completion, onAiGenerate],
  );

  const handleCustomPrompt = useCallback(async () => {
    const source = hasCompletion ? completion : getSelectionMarkdown(editor);
    await runAi('zap', source, inputValue);
    setInputValue('');
  }, [completion, editor, hasCompletion, inputValue, runAi]);

  return (
    <Command className="w-[360px]">
      {hasCompletion && (
        <div className="flex max-h-[360px] border-b">
          <ScrollArea className="w-full">
            <div className="prose prose-sm max-w-none p-3 leading-6 dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2">
              <Markdown>{completion}</Markdown>
            </div>
          </ScrollArea>
        </div>
      )}

      {isLoading && (
        <div className="flex h-12 items-center px-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
          AI is thinking...
        </div>
      )}

      {!isLoading && (
        <>
          {errorMessage && (
            <div className="flex items-center justify-between gap-2 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <span className="truncate">{errorMessage}</span>
              {lastFailedRequest && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() =>
                    runAi(
                      lastFailedRequest.option,
                      lastFailedRequest.selectionMarkdown,
                      lastFailedRequest.command,
                    )
                  }
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          <div className="relative">
            <CommandInput
              value={inputValue}
              onValueChange={setInputValue}
              autoFocus
              placeholder={hasCompletion ? 'Tell AI what to do next' : 'Ask AI to edit or generate'}
              onFocus={() => addAIHighlight(editor)}
            />
            <Button
              size="icon"
              className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
              onClick={handleCustomPrompt}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          {hasCompletion ? (
            <AICompletionCommands
              completion={completion}
              onDiscard={() => {
                editor.chain().unsetHighlight().focus().run();
                setCompletion('');
                setErrorMessage(null);
                setLastFailedRequest(null);
                onOpenChange(false);
              }}
              onReplace={() => {
                const selection = editor.view.state.selection;
                editor
                  .chain()
                  .focus()
                  .insertContentAt(
                    {
                      from: selection.from,
                      to: selection.to,
                    },
                    completion,
                  )
                  .run();
                setCompletion('');
                onOpenChange(false);
              }}
              onInsert={() => {
                const selection = editor.view.state.selection;
                editor.chain().focus().insertContentAt(selection.to + 1, completion).run();
                setCompletion('');
                onOpenChange(false);
              }}
            />
          ) : (
            <AISelectorCommands
              onSelect={async (option) => {
                if (option === 'continue') {
                  const pos = editor.state.selection.from;
                  const text = getPrevText(editor as any, pos);
                  await runAi('continue', text);
                  return;
                }
                const text = getSelectionMarkdown(editor);
                await runAi(option, text);
              }}
            />
          )}
        </>
      )}
    </Command>
  );
}

function AICompletionCommands({
  completion,
  onDiscard,
  onReplace,
  onInsert,
}: {
  completion: string;
  onDiscard: () => void;
  onReplace: () => void;
  onInsert: () => void;
}) {
  if (!completion) return null;

  return (
    <>
      <CommandGroup>
        <CommandItem className="gap-2 px-4" value="replace" onSelect={onReplace}>
          <Check className="h-4 w-4 text-muted-foreground" />
          Replace selection
        </CommandItem>
        <CommandItem className="gap-2 px-4" value="insert" onSelect={onInsert}>
          <StepForward className="h-4 w-4 text-muted-foreground" />
          Insert below
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup>
        <CommandItem className="gap-2 px-4" value="discard" onSelect={onDiscard}>
          <Trash2 className="h-4 w-4 text-muted-foreground" />
          Discard
        </CommandItem>
      </CommandGroup>
    </>
  );
}

function AISelectorCommands({
  onSelect,
}: {
  onSelect: (option: NovelAiOption) => Promise<void> | void;
}) {
  return (
    <>
      <CommandGroup heading="Edit selection">
        {AI_OPTION_ITEMS.map((item) => (
          <CommandItem
            key={item.option}
            value={item.option}
            className="gap-2 px-4"
            onSelect={() => onSelect(item.option)}
          >
            {item.icon}
            <div className="flex flex-col">
              <span>{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.hint}</span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Generate">
        <CommandItem value="continue" className="gap-2 px-4" onSelect={() => onSelect('continue')}>
          <StepForward className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Continue writing
        </CommandItem>
      </CommandGroup>
    </>
  );
}

function NodeSelector({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { editor } = useEditor();
  if (!editor) return null;

  const activeItem =
    NODE_SELECTOR_ITEMS.filter((item) => item.isActive(editor)).pop() ?? ({
      name: 'Multiple',
      icon: Quote,
      command: () => undefined,
      isActive: () => false,
    } as SelectorItem);

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-2 rounded-none border-none">
          <span className="whitespace-nowrap text-sm">{activeItem.name}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        sideOffset={5}
        align="start"
        className={cn('w-56 p-1 shadow-xl', NOVEL_MENU_PANEL_CLASS)}
      >
        {NODE_SELECTOR_ITEMS.map((item) => (
          <EditorBubbleItem
            key={item.name}
            onSelect={(editorInstance) => {
              item.command(editorInstance as EditorInstance);
              onOpenChange(false);
            }}
            className={cn(
              'flex cursor-pointer items-center justify-between rounded-sm px-2 py-1 text-sm',
              NOVEL_MENU_ITEM_CLASS,
            )}
          >
            <div className="flex items-center space-x-2">
              <div className="rounded-sm border border-border/70 bg-muted/35 p-1">
                <item.icon className="h-3 w-3" />
              </div>
              <span>{item.name}</span>
            </div>
            {activeItem.name === item.name && <Check className="h-4 w-4" />}
          </EditorBubbleItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LinkSelector({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { editor } = useEditor();

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  if (!editor) return null;

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-2 rounded-none border-none">
          <Link2 className="h-4 w-4" />
          <span className={cn(editor.isActive('link') && 'text-emerald-600 dark:text-emerald-400')}>Link</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className={cn('w-64 p-0 shadow-xl', NOVEL_MENU_PANEL_CLASS)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const target = event.currentTarget as HTMLFormElement;
            const input = target[0] as HTMLInputElement;
            const url = input.value?.trim();
            if (!url) return;
            try {
              const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
              new URL(normalized);
              editor.chain().focus().setLink({ href: normalized }).run();
              onOpenChange(false);
            } catch {
              toast.error('Invalid URL');
            }
          }}
          className="flex p-1"
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Paste a link"
            className="flex-1 bg-background p-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            defaultValue={(editor.getAttributes('link').href as string) || ''}
          />
          {editor.getAttributes('link').href ? (
            <Button
              size="icon"
              variant="outline"
              type="button"
              className="h-8 rounded-sm text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                if (inputRef.current) inputRef.current.value = '';
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" className="h-8">
              <Check className="h-4 w-4" />
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

function MathSelector() {
  const { editor } = useEditor();
  if (!editor) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-10 rounded-none"
      onClick={() => {
        if (editor.isActive('math')) {
          editor.chain().focus().unsetLatex().run();
          return;
        }
        const { from, to } = editor.state.selection;
        const latex = editor.state.doc.textBetween(from, to);
        if (!latex) return;
        editor.chain().focus().setLatex({ latex }).run();
      }}
    >
      <Sigma className={cn('h-4 w-4', editor.isActive('math') && 'text-emerald-600 dark:text-emerald-400')} />
    </Button>
  );
}

function TextButtons() {
  const { editor } = useEditor();
  if (!editor) return null;

  const items: SelectorItem[] = [
    {
      name: 'bold',
      isActive: (instance) => instance.isActive('bold'),
      command: (instance) => instance.chain().focus().toggleBold().run(),
      icon: Bold,
    },
    {
      name: 'italic',
      isActive: (instance) => instance.isActive('italic'),
      command: (instance) => instance.chain().focus().toggleItalic().run(),
      icon: Italic,
    },
    {
      name: 'underline',
      isActive: (instance) => instance.isActive('underline'),
      command: (instance) => instance.chain().focus().toggleUnderline().run(),
      icon: Underline,
    },
    {
      name: 'strike',
      isActive: (instance) => instance.isActive('strike'),
      command: (instance) => instance.chain().focus().toggleStrike().run(),
      icon: Strikethrough,
    },
    {
      name: 'code',
      isActive: (instance) => instance.isActive('code'),
      command: (instance) => instance.chain().focus().toggleCode().run(),
      icon: Code,
    },
  ];

  return (
    <div className="flex">
      {items.map((item) => (
        <EditorBubbleItem
          key={item.name}
          onSelect={(instance) => {
            item.command(instance as EditorInstance);
          }}
        >
          <Button size="sm" className="rounded-none" variant="ghost" type="button">
            <item.icon className={cn('h-4 w-4', item.isActive(editor) && 'text-emerald-600 dark:text-emerald-400')} />
          </Button>
        </EditorBubbleItem>
      ))}
    </div>
  );
}

function ColorSelector({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { editor } = useEditor();
  if (!editor) return null;

  const activeColor = TEXT_COLOR_ITEMS.find(({ color }) => editor.isActive('textStyle', { color }));
  const activeHighlight = HIGHLIGHT_COLOR_ITEMS.find(({ color }) =>
    editor.isActive('highlight', { color }),
  );

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" className="gap-2 rounded-none" variant="ghost">
          <span
            className="rounded-sm px-1"
            style={{
              color: activeColor?.color,
              backgroundColor: activeHighlight?.color,
            }}
          >
            A
          </span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        sideOffset={5}
        align="start"
        className={cn(
          'my-1 flex max-h-80 w-52 flex-col overflow-hidden overflow-y-auto rounded p-1 shadow-xl',
          NOVEL_MENU_PANEL_CLASS,
        )}
      >
        <div className="my-1 px-2 text-sm font-semibold text-muted-foreground">Text color</div>
        {TEXT_COLOR_ITEMS.map(({ name, color }) => (
          <EditorBubbleItem
            key={name}
            onSelect={() => {
              editor.commands.unsetColor();
              if (name !== 'Default') {
                editor.chain().focus().setColor(color).run();
              }
              onOpenChange(false);
            }}
            className={cn(
              'flex cursor-pointer items-center justify-between px-2 py-1 text-sm',
              NOVEL_MENU_ITEM_CLASS,
            )}
          >
            <div className="flex items-center gap-2">
              <div className="rounded-sm border px-2 py-px font-medium" style={{ color }}>
                A
              </div>
              <span>{name}</span>
            </div>
          </EditorBubbleItem>
        ))}
        <div className="my-1 px-2 text-sm font-semibold text-muted-foreground">Highlight</div>
        {HIGHLIGHT_COLOR_ITEMS.map(({ name, color }) => (
          <EditorBubbleItem
            key={name}
            onSelect={() => {
              editor.commands.unsetHighlight();
              if (name !== 'Default') {
                editor.chain().focus().setHighlight({ color }).run();
              }
              onOpenChange(false);
            }}
            className={cn(
              'flex cursor-pointer items-center justify-between px-2 py-1 text-sm',
              NOVEL_MENU_ITEM_CLASS,
            )}
          >
            <div className="flex items-center gap-2">
              <div className="rounded-sm border px-2 py-px font-medium" style={{ backgroundColor: color }}>
                A
              </div>
              <span>{name}</span>
            </div>
            {editor.isActive('highlight', { color }) && <Check className="h-4 w-4" />}
          </EditorBubbleItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}
