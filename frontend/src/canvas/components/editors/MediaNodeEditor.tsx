// 🎨 媒体节点编辑器
// 处理图片预览和文件信息显示

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import type { MediaNode, FontStyle, CornerStyle, NodeStyles, ExternalVideoProvider } from '../../types/canvas';
import { getMediaTypeIcon, formatFileSize, deriveStoragePath, buildMediaProxyUrl as buildMediaProxyUrlHelper, isAlphaCapableImageFormat, parseExternalVideoUrl, normalizeExternalEmbedUrl } from '../../utils/mediaUtils';
import { CanvasIcon } from '../shared/icons/CanvasIcon';
// Using backend media proxy for stable URLs when fileUrl is absent
import { useAuth } from '@/components/AuthProvider';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { PdfRenderer } from '@/components/thread/preview-renderers/pdf-renderer';
import { VoiceRecorder } from '@/components/thread/chat-input/voice-recorder';
import { uploadFileToStorage } from '@/canvas/services/canvas-media.service';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';

function detectImageHasAlpha(imageEl: HTMLImageElement): boolean | null {
  try {
    const naturalWidth = imageEl.naturalWidth || imageEl.width;
    const naturalHeight = imageEl.naturalHeight || imageEl.height;
    if (!naturalWidth || !naturalHeight) return null;
    const sampleWidth = Math.min(96, Math.max(1, naturalWidth));
    const sampleHeight = Math.min(96, Math.max(1, naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(imageEl, 0, 0, sampleWidth, sampleHeight);
    const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.debug('[media-node] Failed to inspect image transparency', err);
    return null;
  }
}

interface MediaNodeEditorProps {
  node: MediaNode;
  editing?: boolean;
  selected?: boolean;
  fontStyle?: FontStyle;
  cornerStyle?: CornerStyle;
  nodeStyles?: NodeStyles;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
}

const MediaNodeEditor: React.FC<MediaNodeEditorProps> = ({
  node,
  editing = false,
  selected = false,
  fontStyle,
  cornerStyle,
  nodeStyles,
  onContentChange,
  onEditToggle,
  onSizeChange
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const inferExternalProvider = useCallback((value?: string | null): ExternalVideoProvider | undefined => {
    const candidate = (value || '').toLowerCase();
    if (!candidate) return undefined;
    if (candidate.includes('bilibili')) return 'bilibili';
    if (candidate.includes('youtube') || candidate.includes('youtu.be') || candidate.includes('youtube-nocookie')) return 'youtube';
    return undefined;
  }, []);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lastAnalyzedSignatureRef = useRef<string | null>(null);
  const failedImageSourcesRef = useRef<Set<string>>(new Set());
  const [isSigning, setIsSigning] = useState(false);
  const [docPreviewError, setDocPreviewError] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const { session } = useAuth();
  const currentCanvasId = useCanvasStore((state) => state.canvas?.id);
  const updateNodeAction = useCanvasStore((state) => state.updateNode);
  const normalizedExtension = useMemo(() => {
    const extFromNode = node.fileExtension || (node.fileName ? node.fileName.split('.').pop() : '');
    return (extFromNode || '').toLowerCase();
  }, [node.fileExtension, node.fileName]);
  const supportsAlphaFormat = useMemo(() => {
    if (node.mediaType !== 'image') return false;
    return isAlphaCapableImageFormat(normalizedExtension, node.fileType);
  }, [node.mediaType, normalizedExtension, node.fileType]);
  const transparentImagePreference = node.mediaType === 'image'
    ? ((node as any).mediaHasTransparentBg ?? supportsAlphaFormat)
    : false;
  const isPdfFile = normalizedExtension === 'pdf';
  const isDocumentLike = useMemo(() => {
    if (!node.mediaType && !normalizedExtension) return false;
    const mediaTypeMatch = ['document', 'spreadsheet', 'presentation'].includes(node.mediaType || '');
    const extensionMatch = ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'ppt', 'pptx', 'xls', 'xlsx', 'csv'].includes(normalizedExtension);
    return mediaTypeMatch || extensionMatch;
  }, [node.mediaType, normalizedExtension]);
  // 尝试从 Supabase 的签名/公开 URL 中提取 storage 对象路径
  const derivedStoragePath = useMemo(() => deriveStoragePath(node), [node]);

  const buildStableMediaUrl = useCallback((extraParams?: Record<string, string>) => {
    return buildMediaProxyUrlHelper(derivedStoragePath, {
      token: session?.access_token,
      canvasId: currentCanvasId || undefined,
      extraParams,
    });
  }, [derivedStoragePath, session?.access_token, currentCanvasId]);

  const stableOpenUrl = useMemo(() => buildStableMediaUrl(), [buildStableMediaUrl]);
  const stableDownloadUrl = useMemo(() => buildStableMediaUrl(node.fileName ? { download: node.fileName } : undefined), [buildStableMediaUrl, node.fileName]);
  const isExternalVideo = node.mediaType === 'video' && (node.mediaSource === 'external' || node.externalUrl || node.embedUrl);
  const externalVideoInfo = useMemo(() => {
    if (!isExternalVideo) return null;
    if (node.externalUrl) {
      const parsed = parseExternalVideoUrl(node.externalUrl);
      if (parsed) return parsed;
    }
    if (node.embedUrl) {
      const provider = node.externalProvider || inferExternalProvider(node.embedUrl);
      if (!provider) return null;
      return { provider, embedUrl: node.embedUrl, sourceUrl: node.externalUrl || node.embedUrl };
    }
    return null;
  }, [isExternalVideo, node.embedUrl, node.externalUrl, node.externalProvider, inferExternalProvider]);
  const externalProvider = node.externalProvider
    || externalVideoInfo?.provider
    || inferExternalProvider(node.externalUrl)
    || inferExternalProvider(node.embedUrl);
  const externalEmbedUrl = useMemo(() => (
    normalizeExternalEmbedUrl(node.embedUrl || externalVideoInfo?.embedUrl, externalProvider)
  ), [node.embedUrl, externalProvider, externalVideoInfo?.embedUrl]);
  const effectiveExternalProvider = useMemo(() => {
    if (externalProvider) return externalProvider;
    const candidate = (externalEmbedUrl || '').toLowerCase();
    if (candidate.includes('bilibili')) return 'bilibili';
    if (candidate.includes('youtube') || candidate.includes('youtu.be')) return 'youtube';
    return undefined;
  }, [externalProvider, externalEmbedUrl]);
  const externalOpenUrl = node.externalUrl || externalVideoInfo?.sourceUrl || node.embedUrl || undefined;
  const externalOpenLabel = effectiveExternalProvider === 'bilibili' ? '在哔哩哔哩打开' : '在 YouTube 打开';
  const showExternalOpenButton = Boolean(isExternalVideo && externalOpenUrl && selected && !editing);
  const openUrl = isExternalVideo ? externalOpenUrl : stableOpenUrl || node.fileUrl || node.localPath || undefined;
  const downloadUrl = isExternalVideo ? undefined : stableDownloadUrl || node.fileDownloadUrl || stableOpenUrl || undefined;
  const fileSizeLabel = node.fileSize ? formatFileSize(node.fileSize) : null;
  const resolveIconPath = useCallback((extOverride?: string) => {
    const ext = (extOverride || node.fileExtension || '').toLowerCase();
    switch (ext) {
      case 'pdf':
        return '/pdf.png';
      case 'doc':
      case 'docx':
      case 'txt':
      case 'md':
      case 'rtf':
        return '/word.png';
      case 'xls':
      case 'xlsx':
      case 'csv':
      case 'ods':
        return '/excel.png';
      case 'ppt':
      case 'pptx':
      case 'odp':
        return '/ppt.png';
      case 'mp3':
      case 'wav':
      case 'ogg':
      case 'flac':
      case 'm4a':
        return '/audio.svg';
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
      case 'wmv':
      case 'webm':
      case 'flv':
        return '/video.png';
      default: {
        switch (node.mediaType) {
          case 'document':
            return '/word.png';
          case 'spreadsheet':
            return '/excel.png';
          case 'presentation':
            return '/ppt.png';
          case 'audio':
            return '/audio.svg';
          case 'video':
            return '/video.png';
          default:
            return '/word.png';
        }
      }
    }
  }, [node.fileExtension, node.mediaType]);

  const documentIconSrc = useMemo(() => resolveIconPath(normalizedExtension), [resolveIconPath, normalizedExtension]);
  const docPreviewSource = useMemo(() => {
    if (!isDocumentLike) return null;
    if (isPdfFile) {
      return node.localPath || stableOpenUrl || node.fileUrl || null;
    }
    return null;
  }, [isDocumentLike, isPdfFile, node.localPath, stableOpenUrl, node.fileUrl]);

  useEffect(() => {
    setDocPreviewError(false);
  }, [docPreviewSource, node.id]);

  useEffect(() => {
    setIsVideoLoaded(false);
    setVideoError(false);
  }, [node.id, node.fileUrl, node.storagePath, node.externalUrl, node.embedUrl, node.mediaSource]);

  const handleAudioTranscription = useCallback((text: string) => {
    if (!text) return;
    updateNodeAction(node.id, { content: text, kbStatus: 'completed', updatedAt: Date.now() } as any);
  }, [node.id, updateNodeAction]);

  const handlePdfPreviewError = useCallback(() => {
    setDocPreviewError(true);
  }, []);

  const handleAudioRecordingComplete = useCallback(async (file: File) => {
    if (!file) return;
    const extension = (file.name.split('.').pop() || 'webm').toLowerCase();
    const fallbackName = file.name || `录音-${new Date().toISOString().slice(0, 19)}.${extension}`;
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      objectUrl = null;
    }
    setIsUploadingAudio(true);
    const baseUpdates: Partial<MediaNode> = {
      fileName: fallbackName,
      fileType: file.type || 'audio/webm',
      fileExtension: extension,
      fileSize: file.size,
      mediaType: 'audio',
      uploadStatus: 'pending',
      kbStatus: 'pending',
      localPath: objectUrl || undefined,
      updatedAt: Date.now()
    };
    updateNodeAction(node.id, baseUpdates as any);
    try {
      const { path, fileId } = await uploadFileToStorage(file, { source: 'canvas-audio' });
      updateNodeAction(node.id, {
        storagePath: path,
        fileId,
        uploadStatus: 'uploaded',
        localPath: objectUrl || undefined,
        fileUrl: undefined,
        fileDownloadUrl: undefined,
        updatedAt: Date.now()
      } as any);
    } catch (error) {
      console.error('Audio upload failed:', error);
      toast.error('音频上传失败，请重试');
      updateNodeAction(node.id, { uploadStatus: 'error' } as any);
    } finally {
      setIsUploadingAudio(false);
    }
  }, [node.id, updateNodeAction]);

  useEffect(() => {
    setIsVideoLoaded(false);
    setVideoError(false);
  }, [node.id, node.fileUrl, node.storagePath]);
  // 获取媒体类型图标和颜色
  const { icon } = getMediaTypeIcon(node.mediaType);

  // 🎯 处理内容变更
  const handleContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = event.target.value;
    onContentChange?.(node.id, newContent);
  }, [node.id, onContentChange]);

  // 🎯 处理双击编辑切换
  const openPdfInNativeViewer = useCallback(() => {
    if (!openUrl) return;
    const viewer = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
    if (!viewer) return;
    viewer.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${node.fileName || 'Document'}</title>
          <style>
            html, body { margin: 0; height: 100%; background: #111; }
            iframe { border: 0; width: 100%; height: 100%; }
          </style>
        </head>
        <body>
          <iframe src="${openUrl}#toolbar=1&navpanes=1" allow="fullscreen"></iframe>
        </body>
      </html>
    `);
    viewer.document.close();
  }, [openUrl, node.fileName]);

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isDocumentLike) {
      if (isPdfFile) {
        openPdfInNativeViewer();
      } else if (openUrl) {
        try { window.open(openUrl, '_blank', 'noopener,noreferrer'); } catch {}
      }
      return;
    }
    onEditToggle?.(node.id, !editing);
  }, [node.id, editing, onEditToggle, isDocumentLike, isPdfFile, openUrl, openPdfInNativeViewer]);

  // 🎯 处理键盘事件
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEditToggle?.(node.id, false);
    }
    // 允许其他按键正常工作，不阻止事件传播
  }, [node.id, onEditToggle]);

  // 🎯 图片加载处理
  const detectTransparentBackground = useCallback(() => {
    if (node.mediaType !== 'image') return;
    const imgEl = imageRef.current;
    if (!imgEl || !imgEl.complete) return;
    const signature = [
      node.storagePath || '',
      node.fileUrl || '',
      node.localPath || '',
      imageSrc || ''
    ].join('|');
    if (lastAnalyzedSignatureRef.current === signature && typeof (node as any).mediaHasTransparentBg === 'boolean') {
      return;
    }
    const hasAlpha = detectImageHasAlpha(imgEl);
    if (hasAlpha === null) return;
    lastAnalyzedSignatureRef.current = signature;
    if ((node as any).mediaHasTransparentBg !== hasAlpha) {
      updateNodeAction(node.id, { mediaHasTransparentBg: hasAlpha } as any);
    }
  }, [node, imageSrc, updateNodeAction]);
  useEffect(() => {
    lastAnalyzedSignatureRef.current = null;
  }, [node.id]);

  const handleImageLoad = useCallback(() => {
    setIsImageLoaded(true);
    setImageError(false);
    setIsSigning(false);
    detectTransparentBackground();
  }, [detectTransparentBackground]);

  const handleImageError = useCallback(() => {
    if (imageSrc) failedImageSourcesRef.current.add(imageSrc);
    const stable = buildStableMediaUrl();
    const candidates = [stable, node.fileUrl, node.localPath].filter((src): src is string => !!src);
    const nextSource = candidates.find((src) => !failedImageSourcesRef.current.has(src));
    if (nextSource) {
      setImageError(false);
      setIsImageLoaded(false);
      setImageSrc(nextSource);
      setIsSigning(nextSource !== node.localPath);
      return;
    }
    setImageError(true);
    setIsImageLoaded(false);
    setIsSigning(false);
  }, [imageSrc, buildStableMediaUrl, node.fileUrl, node.localPath]);

  useEffect(() => {
    if (node.mediaType !== 'image') return;
    failedImageSourcesRef.current.clear();
    const stable = buildStableMediaUrl();
    const nextSource = stable || node.fileUrl || node.localPath || null;
    setImageSrc(nextSource);
    setImageError(false);
    setIsImageLoaded(false);
    setIsSigning(!!nextSource && nextSource !== node.localPath);
  }, [node.id, node.mediaType, node.fileUrl, node.storagePath, node.localPath, buildStableMediaUrl]);

  // 🎯 自动聚焦到textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.focus();
      // 将光标定位到文本末尾
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, [editing]);

  // 🎯 计算文本区域高度
  const textareaHeight = Math.max(60, Math.min(200, (node.content?.length || 0) * 0.5 + 60));

  // 🎨 生成玻璃态样式
  const glassStyle = useMemo(() => ({
    background: isDark ? 'rgba(24, 24, 27, 0.78)' : 'rgba(255, 255, 255, 0.8)',
    backdropFilter: 'blur(12px)',
    border: isDark ? '1px solid rgba(161, 161, 170, 0.26)' : '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: isDark ? '0 8px 32px rgba(0, 0, 0, 0.32)' : '0 8px 32px rgba(0, 0, 0, 0.1)',
  }), [isDark]);

  const cornerRadius = typeof cornerStyle?.radius === 'number'
    ? `${cornerStyle.radius}px`
    : '8px';
  const mediaOpacity = typeof (node as any).opacity === 'number' ? (node as any).opacity : 1;

  // 🖼️ 渲染图片预览（纯净版本）
  const renderImagePreview = () => {
    if (node.mediaType !== 'image') return null;

    if (imageSrc) {
      return (
        <div className="relative w-full h-full overflow-hidden" onDoubleClick={handleDoubleClick}>
          {!imageError ? (
            <Image
              ref={imageRef}
              src={imageSrc}
              alt={node.fileName}
              crossOrigin="anonymous"
              fill
              unoptimized
              loader={({ src }) => src}
              className="object-cover transition-opacity duration-300 cursor-pointer"
              style={{
                opacity: isImageLoaded ? 1 : 0
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
              sizes="100vw"
            />
          ) : null}

          {((isSigning || !isImageLoaded) && !imageError) && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-transparent"
            >
              <div className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-zinc-600 dark:border-t-zinc-100 animate-spin" />
            </div>
          )}

          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center bg-transparent">
              <div className="text-4xl text-gray-300 dark:text-zinc-500">🖼️</div>
            </div>
          )}
        </div>
      );
    }

    // AI generation in progress: pending + no image source
    if (node.uploadStatus === 'pending') {
      return (
        <div className="relative w-full h-full overflow-hidden" style={{ borderRadius: cornerRadius }}>
          <style>{`
            @keyframes aiShimmer {
              0% { background-position: -200% 0; }
              100% { background-position: 200% 0; }
            }
            @keyframes aiPulseRing {
              0%, 100% { transform: scale(1); opacity: 0.6; }
              50% { transform: scale(1.35); opacity: 0.15; }
            }
            @keyframes aiDotBounce {
              0%, 80%, 100% { transform: translateY(0); }
              40% { transform: translateY(-4px); }
            }
          `}</style>
          {/* Animated gradient background */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(110deg, #f0f4ff 0%, #e8eeff 25%, #f5f0ff 50%, #e8eeff 75%, #f0f4ff 100%)',
              backgroundSize: '200% 100%',
              animation: 'aiShimmer 3s ease-in-out infinite',
            }}
          />
          {/* Subtle grid pattern overlay */}
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }} />
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {/* Pulsing ring */}
            <div className="relative flex items-center justify-center">
              <div
                className="w-20 h-20 rounded-full border-[2.5px] border-indigo-400/60"
                style={{ animation: 'aiPulseRing 2.4s ease-in-out infinite' }}
              />
            </div>
            {/* Animated dots text */}
            <div className="flex items-center gap-0.5 text-xs font-medium text-indigo-400/80 tracking-wide">
              <span>AI Generating</span>
              <span style={{ animation: 'aiDotBounce 1.4s ease-in-out infinite' }}>.</span>
              <span style={{ animation: 'aiDotBounce 1.4s ease-in-out 0.2s infinite' }}>.</span>
              <span style={{ animation: 'aiDotBounce 1.4s ease-in-out 0.4s infinite' }}>.</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="relative w-full h-full overflow-hidden" style={{ borderRadius: cornerRadius }} onDoubleClick={handleDoubleClick}>
        {isSigning ? (
          <div className="absolute inset-0 flex items-center justify-center bg-transparent">
            <div className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-zinc-600 dark:border-t-zinc-100 animate-spin" />
          </div>
        ) : (
          <div
            className="w-full h-full flex items-center justify-center cursor-pointer bg-gray-100 dark:bg-zinc-800/70 transition-colors duration-200 hover:bg-accent/60"
          >
            <div className="text-6xl text-gray-400 dark:text-zinc-500">📷</div>
          </div>
        )}
      </div>
    );
  };

  const renderInfoSection = () => {
    const iconSrc = documentIconSrc;
    const isVideoInfo = node.mediaType === 'video';
    const infoClassName = isVideoInfo
      ? 'px-4 py-3 bg-card border-t border-transparent flex flex-col gap-1 flex-shrink-0 min-h-[60px]'
      : 'px-4 py-3 bg-white/95 dark:bg-zinc-900/90 backdrop-blur border-t border-border/60 dark:border-zinc-700/60 flex flex-col gap-1 flex-shrink-0 min-h-[60px]';
    return (
      <div className={infoClassName} onDoubleClick={handleDoubleClick}>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 flex items-center justify-center overflow-hidden" style={{ borderRadius: cornerRadius }}>
            {iconSrc ? (
              <Image
                src={iconSrc}
                alt={normalizedExtension || node.mediaType || 'file'}
                width={48}
                height={48}
                unoptimized
                loader={({ src }) => src}
                className="w-12 h-12 object-contain"
                draggable={false}
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
            ) : (
              <CanvasIcon name={icon} size={28} strokeWidth={1.6} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13px] text-gray-900 dark:text-zinc-100 truncate w-full" title={node.fileName || undefined}>
              {node.fileName}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap w-full">
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-gray-900 dark:hover:text-zinc-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </a>
              )}
              {openUrl && !isExternalVideo && (
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-gray-900 dark:hover:text-zinc-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                </a>
              )}
              {node.kbStatus && (
                <span
                  className={`px-1.5 py-0.5 rounded border ${
                    node.kbStatus === 'pending'
                      ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800/60'
                      : node.kbStatus === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800/60'
                        : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800/60'
                  }`}
                >
                  KB: {node.kbStatus}
                </span>
              )}
              {showExternalOpenButton && (
                <a
                  href={externalOpenUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-node-interactive="true"
                  className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900 text-white text-xs dark:bg-zinc-100 dark:text-zinc-900"
                  onClick={(e) => e.stopPropagation()}
                >
                  {externalOpenLabel}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCardShell = (
    preview: React.ReactNode,
    options?: { background?: string; showInfo?: boolean; transparentBackground?: boolean }
  ) => {
    const backgroundClass = options?.transparentBackground ? 'bg-transparent' : 'bg-white dark:bg-zinc-900';
    const hideChrome = Boolean(options?.transparentBackground) || mediaOpacity <= 0;
    const suppressChromeBorder = node.mediaType === 'video';
    const chromeClass = (hideChrome || suppressChromeBorder)
      ? 'border-0 shadow-sm'
      : 'border border-border/50 dark:border-zinc-700/60 shadow-sm';
    return (
      <div
        className={`relative w-full h-full flex flex-col ${backgroundClass} ${chromeClass} overflow-hidden`}
        style={{
          opacity: mediaOpacity,
          borderRadius: cornerRadius,
          backgroundColor: options?.transparentBackground ? 'transparent' : undefined,
          boxShadow: hideChrome ? 'none' : undefined
        }}
      >
        <div className="flex-1 min-h-0 relative overflow-hidden" onDoubleClick={handleDoubleClick}>
          {options?.background ? (
            <div
              className="absolute inset-0 pointer-events-none mix-blend-multiply opacity-80 z-0"
              style={{ backgroundImage: options.background }}
            />
          ) : null}
          <div className="relative z-10 w-full h-full">
            {preview}
          </div>
          {renderStatusOverlay()}
        </div>
        {options?.showInfo === false ? null : renderInfoSection()}
      </div>
    );
  };

  const renderDocumentCard = () => {
    if (!isDocumentLike) return null;
    const showLoading = node.uploadStatus === 'pending' && !docPreviewSource;
    const docGradient = (() => {
      if (['ppt', 'pptx', 'odp', 'pdf'].includes(normalizedExtension) || node.mediaType === 'presentation') {
        return 'linear-gradient(135deg, rgba(248,113,113,0.35), rgba(220,38,38,0.65))';
      }
      if (['xls', 'xlsx', 'csv', 'ods'].includes(normalizedExtension) || node.mediaType === 'spreadsheet') {
        return 'linear-gradient(135deg, rgba(34,197,94,0.3), rgba(5,150,105,0.6))';
      }
      if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(normalizedExtension) || node.mediaType === 'document') {
        return 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(37,99,235,0.6))';
      }
      return 'linear-gradient(135deg, rgba(148,163,184,0.3), rgba(100,116,139,0.6))';
    })();

    const preview = docPreviewSource && !docPreviewError && isPdfFile ? (
      <div className="w-full h-full overflow-hidden">
        <PdfRenderer
          url={docPreviewSource}
          className="w-full h-full pointer-events-none overflow-hidden [&_.react-pdf__Page__canvas]:!w-full [&_.react-pdf__Page__canvas]:!h-full [&_.react-pdf__Page__canvas]:object-cover [&_.react-pdf__Page__canvas]:block [&_.react-pdf__Page]:!overflow-hidden"
          onError={handlePdfPreviewError}
        />
      </div>
    ) : showLoading ? (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-zinc-600 dark:border-t-zinc-100 animate-spin" />
      </div>
    ) : (
      <div className="absolute inset-0" />
    );

    return renderCardShell(preview, { background: docGradient });
  };

  const renderVideoPreview = () => {
    if (node.mediaType !== 'video') return null;
    const videoSourceUrl = isExternalVideo ? externalEmbedUrl : openUrl;
    if (!videoSourceUrl) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-neutral-900">
          <CanvasIcon name="video" size={48} strokeWidth={1.4} className="text-gray-400 dark:text-zinc-500" />
        </div>
      );
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/5 dark:bg-white/5 relative">
        {isExternalVideo ? (
          <iframe
            className="w-full h-full border-0 outline-none"
            src={videoSourceUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            data-node-interactive="true"
            onLoad={() => { setIsVideoLoaded(true); setVideoError(false); }}
            onError={() => { setVideoError(true); setIsVideoLoaded(false); }}
            title={node.fileName || 'Video'}
          />
        ) : (
          <video
            className="w-full h-full object-cover border-0 outline-none"
            src={videoSourceUrl}
            controls
            data-node-interactive="true"
            onLoadedData={() => { setIsVideoLoaded(true); setVideoError(false); }}
            onError={() => { setVideoError(true); setIsVideoLoaded(false); }}
          />
        )}
        {!isVideoLoaded && !videoError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/20 dark:bg-black/40 backdrop-blur-sm">
            <div className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-zinc-600 dark:border-t-zinc-100 animate-spin" />
          </div>
        )}
        {videoError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-zinc-900/95">
            <div className="text-gray-400 dark:text-zinc-500 text-sm">视频加载失败</div>
          </div>
        )}
      </div>
    );
  };

  const renderAudioPreview = () => {
    if (node.mediaType !== 'audio') return null;
    return (
      <div className={`w-full h-full flex flex-col items-center justify-center gap-4 px-6 text-center ${isDark ? 'bg-gradient-to-br from-zinc-900 via-indigo-950/40 to-purple-950/40' : 'bg-gradient-to-br from-purple-50 to-indigo-50'}`}>
        <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-inner ${isDark ? 'text-indigo-200 bg-zinc-800' : 'text-purple-600 bg-white'}`}>
          <CanvasIcon name="audio" size={32} strokeWidth={1.5} />
        </div>
        {openUrl ? (
          <audio controls className="w-5/6" src={openUrl} data-node-interactive="true">
            您的浏览器不支持 audio 标签。
          </audio>
        ) : (
          <div className="text-sm text-gray-500 dark:text-zinc-400">暂无可播放的音频内容</div>
        )}
        {node.content ? (
          <div className="text-xs text-gray-600 dark:text-zinc-300 whitespace-pre-wrap w-full">
            {node.content}
          </div>
        ) : null}
      </div>
    );
  };

  const renderAudioRecorder = () => {
    const disabled = isUploadingAudio || node.uploadStatus === 'pending';
    return (
      <div className={`w-full h-full flex flex-col items-center justify-center gap-4 px-6 text-center ${isDark ? 'bg-gradient-to-br from-zinc-900 via-zinc-900 to-indigo-950/50' : 'bg-gradient-to-br from-purple-50 via-white to-indigo-50'}`}>
        <p className="text-sm text-gray-600 dark:text-zinc-300">
          拖入后即可在画布中直接录音。点击下方按钮开始捕捉语音，并自动生成媒体节点。
        </p>
        <VoiceRecorder
          disabled={disabled}
          onRecordingComplete={handleAudioRecordingComplete}
          onTranscription={handleAudioTranscription}
        />
        {node.uploadStatus === 'error' ? (
          <p className="text-xs text-red-500">上传失败，请重试。</p>
        ) : null}
      </div>
    );
  };

  // 🎯 获取文件类型对应的PNG图标
  const getFileIcon = () => resolveIconPath(node.fileExtension || node.fileName?.split('.').pop());

  // 📝 渲染文本编辑区域
  const renderTextArea = () => {
    if (!editing) {
      return (
        <div 
          className="w-full p-3 cursor-pointer transition-colors duration-200 hover:bg-accent/40"
          style={{ 
            ...glassStyle,
            borderRadius: cornerRadius,
            minHeight: '60px'
          }}
          onDoubleClick={handleDoubleClick}
        >
          <div className="text-sm text-gray-700 dark:text-zinc-200 whitespace-pre-wrap">
            {node.content || '双击编辑描述...'}
          </div>
        </div>
      );
    }

  return (
      <textarea
        ref={textareaRef}
        value={node.content || ''}
        onChange={handleContentChange}
        onKeyDown={handleKeyDown}
        className="w-full p-3 resize-none border-0 outline-none bg-transparent text-sm"
        style={{ 
          ...glassStyle,
          borderRadius: cornerRadius,
          height: `${textareaHeight}px`,
          fontFamily: fontStyle?.fontFamily || 'inherit'
        }}
        placeholder="为这个文件添加描述..."
        autoFocus
      />
    );
  };

  // 🏷️ 渲染状态标签
  const renderStatusOverlay = () => {
    const showUploadBar = node.uploadStatus === 'pending';
    const showUploadError = node.uploadStatus === 'error';
    const showKbBar = node.kbStatus === 'pending';
    const showKbError = node.kbStatus === 'failed';
    if (!showUploadBar && !showUploadError && !showKbBar && !showKbError) return null;

    const shimmerBar = (key: string) => (
      <div key={key} className={`relative h-2 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700/70' : 'bg-white/20'}`}>
        <div className={`absolute inset-0 rounded-full animate-[progressSlide_1.4s_infinite_linear] ${isDark ? 'bg-gradient-to-r from-zinc-500/30 via-zinc-100/80 to-zinc-500/30' : 'bg-gradient-to-r from-white/40 via-white/90 to-white/40'}`} />
      </div>
    );

    return (
      <>
        <style>{`
          @keyframes progressSlide {
            0% { transform: translateX(-60%); }
            100% { transform: translateX(60%); }
          }
        `}</style>
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 space-y-2 pointer-events-none">
          {showUploadBar && shimmerBar('upload')}
          {showKbBar && shimmerBar('kb')}
          {showUploadError && (
            <div className="h-2 rounded-full bg-red-300/80 dark:bg-red-700/70" />
          )}
          {showKbError && (
            <div className="h-2 rounded-full bg-red-300/80 dark:bg-red-700/70" />
          )}
        </div>
      </>
    );
  };

  // 🎨 根据媒体类型选择渲染模式
  if (node.mediaType === 'image') {
    return renderCardShell(renderImagePreview() || <div />, {
      showInfo: false,
      transparentBackground: transparentImagePreference
    });
  }

  if (node.mediaType === 'video') {
    return renderCardShell(renderVideoPreview());
  }

  if (node.mediaType === 'audio') {
    const hasAudioSource = Boolean(node.storagePath || node.localPath);
    const showRecorder = !hasAudioSource;
    return renderCardShell(showRecorder ? renderAudioRecorder() : renderAudioPreview());
  }

  if (isDocumentLike) {
    return renderDocumentCard();
  }

  return renderCardShell(
    <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-zinc-900/70">
      <CanvasIcon name={icon} size={48} strokeWidth={1.6} className="text-gray-400 dark:text-zinc-500" />
    </div>
  );
};

export default MediaNodeEditor;
