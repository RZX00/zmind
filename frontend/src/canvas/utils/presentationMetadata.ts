import type { CanvasNode } from '../types/canvas';

export const PRESENTATION_SCHEMA = 'presentation.v1';
export const PRESENTATION_KIND = 'ppt_html';
export const PRESENTATION_VERSION = '2';
export const PRESENTATION_LEGACY_VERSION = '1';

type JsonObject = Record<string, unknown>;

export type PresentationRole = 'outline_card' | 'result_html' | 'image_asset';
export type PresentationExportKey = 'pptx' | 'googleSlides' | 'html';
export type PresentationExportStatus = 'idle' | 'running' | 'success' | 'failed';

export type SlideLayout =
  | 'title'
  | 'content'
  | 'image_left'
  | 'image_right'
  | 'comparison'
  | 'data'
  | 'quote'
  | 'timeline'
  | 'team'
  | 'closing';

export interface SlideDataJson {
  order: number;
  layout: SlideLayout;
  title?: string;
  subtitle?: string;
  points?: string[];
  content?: string;
  image_url?: string;
  image_alt?: string;
  speaker_notes?: string;
  [key: string]: unknown;
}

export interface PresentationDataJson {
  title: string;
  style: string;
  lang: string;
  slides: SlideDataJson[];
}

export interface PresentationExportState {
  status: PresentationExportStatus;
  updatedAt: string;
  result?: {
    url?: string;
    fileName?: string;
    presentationId?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface PresentationMetadata extends JsonObject {
  schema?: string;
  projectId?: string;
  role?: PresentationRole;
  kind?: string;
  version?: string;
  title?: string;
  presentationPath?: string;
  slideCount?: number;
  threadId?: string;
  sourceOutlineNodeIds?: string[];
  style?: string;
  slides_json?: PresentationDataJson;
  template_version?: string;
  capabilities?: {
    fullscreen?: boolean;
    downloadPptx?: boolean;
    exportGoogleSlides?: boolean;
    [key: string]: unknown;
  };
  exports?: Partial<Record<PresentationExportKey, PresentationExportState>> & JsonObject;
}

const PRESENTATION_ROLES: PresentationRole[] = ['outline_card', 'result_html', 'image_asset'];

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
  return normalized.length > 0 ? normalized : undefined;
};

const isPresentationRole = (value: unknown): value is PresentationRole =>
  typeof value === 'string' && PRESENTATION_ROLES.includes(value as PresentationRole);

const pickLegacyPresentationPath = (data: JsonObject | undefined): string | undefined => {
  if (!data) return undefined;
  return (
    asString(data.presentationPath) ||
    asString(data.presentation_path) ||
    asString(data.path)
  );
};

const readPathFromHtmlComment = (htmlContent: string): string | undefined => {
  const markerMatch = htmlContent.match(/presentation[_-]?path\s*[:=]\s*["']?([^\s"'<>]+)/i);
  return markerMatch?.[1]?.trim();
};

const toDataObject = (node: CanvasNode): JsonObject => {
  if (isObject(node.data)) return { ...node.data };
  return {};
};

export const looksLikePresentationHtml = (htmlContent: string): boolean => {
  if (!htmlContent || typeof htmlContent !== 'string') return false;
  const hasSlideSections = /class=["'][^"']*slide/i.test(htmlContent);
  const hasNavigation = /page-indicator|progress-bar|toggleFullscreen|keydown/i.test(htmlContent);
  return hasSlideSections && hasNavigation;
};

export const getPresentationMetadata = (node: CanvasNode): PresentationMetadata | null => {
  const data = isObject(node.data) ? node.data : undefined;
  const nested = data && isObject(data.presentation) ? (data.presentation as JsonObject) : undefined;
  const raw = nested || {};

  const role = isPresentationRole(raw.role)
    ? raw.role
    : isPresentationRole(data?.role)
      ? data?.role
      : undefined;

  const presentationPath =
    asString(raw.presentationPath) ||
    asString(raw.presentation_path) ||
    pickLegacyPresentationPath(data) ||
    (node.type === 'code' && node.codeType === 'html' ? readPathFromHtmlComment(node.content || '') : undefined);

  const title = asString(raw.title) || asString((node as any).title);
  const projectId = asString(raw.projectId) || asString(raw.project_id);
  const threadId = asString(raw.threadId) || asString(raw.thread_id);
  const kind = asString(raw.kind);
  const version = asString(raw.version);
  const slideCount = asNumber(raw.slideCount) ?? asNumber(raw.slide_count);
  const sourceOutlineNodeIds = asStringArray(raw.sourceOutlineNodeIds) || asStringArray(raw.source_outline_node_ids);

  const capabilities = isObject(raw.capabilities)
    ? ({ ...raw.capabilities } as PresentationMetadata['capabilities'])
    : undefined;
  const exportsState = isObject(raw.exports)
    ? ({ ...raw.exports } as PresentationMetadata['exports'])
    : undefined;

  const hasExplicitFields = Boolean(
    role ||
      kind ||
      version ||
      presentationPath ||
      title ||
      projectId ||
      threadId ||
      slideCount ||
      sourceOutlineNodeIds?.length ||
      capabilities ||
      exportsState
  );

  if (!hasExplicitFields && !(node.type === 'code' && node.codeType === 'html' && looksLikePresentationHtml(node.content || ''))) {
    return null;
  }

  const metadata: PresentationMetadata = {
    ...(raw as PresentationMetadata),
    schema: asString(raw.schema) || PRESENTATION_SCHEMA,
    role,
    kind: kind || (role === 'result_html' || presentationPath ? PRESENTATION_KIND : undefined),
    version: version || (role === 'result_html' || presentationPath ? PRESENTATION_VERSION : undefined),
    title,
    presentationPath,
    projectId,
    threadId,
    slideCount,
    sourceOutlineNodeIds,
    ...(capabilities ? { capabilities } : {}),
    ...(exportsState ? { exports: exportsState } : {}),
  };

  if (!metadata.role && node.type === 'code' && node.codeType === 'html' && looksLikePresentationHtml(node.content || '')) {
    metadata.role = 'result_html';
    metadata.kind = metadata.kind || PRESENTATION_KIND;
    metadata.version = metadata.version || PRESENTATION_VERSION;
  }

  return metadata;
};

export const isPresentationResultHtmlNode = (node: CanvasNode): boolean => {
  if (!(node.type === 'code' && node.codeType === 'html')) return false;
  const metadata = getPresentationMetadata(node);
  if (!metadata) return false;
  return metadata.role === 'result_html' || metadata.kind === PRESENTATION_KIND || Boolean(metadata.presentationPath);
};

export const isPresentationOutlineNode = (node: CanvasNode): boolean => {
  if (node.type !== 'text') return false;
  const metadata = getPresentationMetadata(node);
  return metadata?.role === 'outline_card';
};

export const isPresentationImageNode = (node: CanvasNode): boolean => {
  if (!(node.type === 'media' && node.mediaType === 'image')) return false;
  const metadata = getPresentationMetadata(node);
  return metadata?.role === 'image_asset';
};

export const getPresentationPath = (node: CanvasNode): string | null => {
  const metadata = getPresentationMetadata(node);
  if (metadata?.presentationPath) return metadata.presentationPath;
  const legacyPath = pickLegacyPresentationPath(isObject(node.data) ? node.data : undefined);
  return legacyPath || null;
};

export const resolvePresentationTitle = (node: CanvasNode): string => {
  const metadata = getPresentationMetadata(node);
  if (metadata?.title) return metadata.title;
  if (typeof (node as any).title === 'string' && (node as any).title.trim()) {
    return (node as any).title.trim();
  }
  if (node.type === 'code' && node.codeType === 'html' && node.content) {
    const titleMatch = node.content.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return titleMatch[1].trim();
    const h1Match = node.content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1]) return h1Match[1].trim();
  }
  return 'presentation';
};

export const upsertPresentationMetadata = (
  node: CanvasNode,
  patch: Partial<PresentationMetadata>,
): JsonObject => {
  const data = toDataObject(node);
  const current = getPresentationMetadata(node) || {};

  const nextExports =
    patch.exports || current.exports
      ? {
          ...(isObject(current.exports) ? current.exports : {}),
          ...(isObject(patch.exports) ? patch.exports : {}),
        }
      : undefined;

  const nextCapabilities =
    patch.capabilities || current.capabilities
      ? {
          ...(isObject(current.capabilities) ? current.capabilities : {}),
          ...(isObject(patch.capabilities) ? patch.capabilities : {}),
        }
      : undefined;

  const next: PresentationMetadata = {
    ...current,
    ...patch,
    schema: patch.schema || current.schema || PRESENTATION_SCHEMA,
    ...(nextCapabilities ? { capabilities: nextCapabilities } : {}),
    ...(nextExports ? { exports: nextExports } : {}),
  };

  if (next.role === 'result_html') {
    next.kind = next.kind || PRESENTATION_KIND;
    next.version = next.version || PRESENTATION_VERSION;
    next.template_version = next.template_version || next.version;
  }

  data.presentation = next;
  return data;
};

export const updatePresentationExportState = (
  node: CanvasNode,
  key: PresentationExportKey,
  state: Partial<PresentationExportState> & Pick<PresentationExportState, 'status' | 'updatedAt'>,
): JsonObject => {
  const current = getPresentationMetadata(node) || {};
  const currentExports = isObject(current.exports) ? current.exports : {};
  const previous = isObject(currentExports[key]) ? (currentExports[key] as JsonObject) : {};

  const nextExport = {
    ...previous,
    ...state,
  } as PresentationExportState;

  return upsertPresentationMetadata(node, {
    exports: {
      ...(currentExports as JsonObject),
      [key]: nextExport,
    } as PresentationMetadata['exports'],
  });
};

