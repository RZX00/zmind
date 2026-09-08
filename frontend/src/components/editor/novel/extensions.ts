import { cx } from 'class-variance-authority';
import { common, createLowlight } from 'lowlight';
import {
  AIHighlight,
  CharacterCount,
  CodeBlockLowlight,
  Color,
  CustomKeymap,
  GlobalDragHandle,
  HighlightExtension,
  HorizontalRule,
  Mathematics,
  Placeholder,
  StarterKit,
  TaskItem,
  TaskList,
  TextStyle,
  TiptapLink,
  TiptapUnderline,
  Twitter,
  UpdatedImage,
  UploadImagesPlugin,
  Youtube,
} from 'novel';
import { Markdown } from 'tiptap-markdown';

interface NovelExtensionOptions {
  enableGlobalDragHandle?: boolean;
}

export function createNovelExtensions(
  placeholderText?: string,
  options?: NovelExtensionOptions,
) {
  const hasCustomPlaceholder = typeof placeholderText === 'string';
  const placeholder = hasCustomPlaceholder
    ? Placeholder.configure({
        placeholder: placeholderText,
        includeChildren: true,
      })
    : Placeholder;

  const tiptapLink = TiptapLink.configure({
    HTMLAttributes: {
      class: cx(
        'text-muted-foreground underline underline-offset-[3px] hover:text-primary transition-colors cursor-pointer',
      ),
    },
  });

  const updatedImage = UpdatedImage.extend({
    addProseMirrorPlugins() {
      return [
        UploadImagesPlugin({
          imageClass: cx('opacity-40 rounded-xl border border-border/70'),
        }),
      ];
    },
  }).configure({
    allowBase64: true,
    HTMLAttributes: {
      class: cx('rounded-lg border border-muted'),
    },
  });

  const taskList = TaskList.configure({
    HTMLAttributes: {
      class: cx('not-prose my-3 pl-0'),
    },
  });

  const taskItem = TaskItem.configure({
    HTMLAttributes: {
      class: cx('my-1 flex items-start gap-2'),
    },
    nested: true,
  });

  const horizontalRule = HorizontalRule.configure({
    HTMLAttributes: {
      class: cx('my-8 border-t border-border/80'),
    },
  });

  const starterKit = StarterKit.configure({
    bulletList: {
      HTMLAttributes: {
        class: cx('my-3 list-disc pl-6'),
      },
    },
    orderedList: {
      HTMLAttributes: {
        class: cx('my-3 list-decimal pl-6'),
      },
    },
    listItem: {
      HTMLAttributes: {
        class: cx('my-1 leading-7'),
      },
    },
    blockquote: {
      HTMLAttributes: {
        class: cx('my-5 border-l-2 border-border pl-4 text-muted-foreground'),
      },
    },
    codeBlock: false,
    code: {
      HTMLAttributes: {
        class: cx('rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em]'),
        spellcheck: 'false',
      },
    },
    horizontalRule: false,
    dropcursor: {
      color: '#DBEAFE',
      width: 4,
    },
    gapcursor: false,
  });

  const codeBlockLowlight = CodeBlockLowlight.configure({
    lowlight: createLowlight(common),
    HTMLAttributes: {
      class: cx('my-4 rounded-xl border border-border/70 bg-muted/45 p-4 font-mono text-sm leading-6 text-foreground'),
    },
  });

  const youtube = Youtube.configure({
    HTMLAttributes: {
      class: cx('rounded-lg border border-muted'),
    },
    inline: false,
  });

  const twitter = Twitter.configure({
    HTMLAttributes: {
      class: cx('not-prose'),
    },
    inline: false,
  });

  const mathematics = Mathematics.configure({
    HTMLAttributes: {
      class: cx('text-foreground rounded p-1 hover:bg-accent cursor-pointer'),
    },
    katexOptions: {
      throwOnError: false,
    },
  });

  const characterCount = CharacterCount.configure();
  const markdownExtension = Markdown.configure({
    html: true,
    tightLists: true,
    tightListClass: 'tight',
    bulletListMarker: '-',
    linkify: false,
    breaks: false,
    transformPastedText: false,
    transformCopiedText: false,
  });
  const globalDragHandle = options?.enableGlobalDragHandle === false ? null : GlobalDragHandle;

  const extensions = [
    starterKit,
    placeholder,
    tiptapLink,
    updatedImage,
    taskList,
    taskItem,
    horizontalRule,
    AIHighlight,
    codeBlockLowlight,
    youtube,
    twitter,
    mathematics,
    characterCount,
    TiptapUnderline,
    markdownExtension,
    HighlightExtension,
    TextStyle,
    Color,
    CustomKeymap,
  ];

  if (globalDragHandle) {
    extensions.push(globalDragHandle);
  }

  return extensions;
}
