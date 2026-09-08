import React, { useRef, useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { CircleDashed, CheckCircle, AlertTriangle, FileJson } from 'lucide-react';
import { UnifiedMessage, ParsedContent, ParsedMetadata, CtaAction, CanvasPreviewMessage } from '@/components/thread/types';
import { FileAttachmentGrid } from '@/components/thread/file-attachment';
import { useFilePreloader } from '@/hooks/react-query/files';
import { useAuth } from '@/components/AuthProvider';
import { Project } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import {
    extractPrimaryParam,
    getToolIcon,
    getUserFriendlyToolName,
    safeJsonParse,
} from '@/components/thread/utils';
import { ZmindLogo } from '@/components/sidebar/zmind-logo';
import LoadingDot from './LoadingDot';
import { AgentLoader } from './loader';
import { AgentAvatar, AgentName } from './agent-avatar';
import { parseXmlToolCalls, isNewXmlFormat } from '@/components/thread/tool-views/xml-parser';
import { ShowToolStream } from './ShowToolStream';
import { ComposioUrlDetector } from './composio-url-detector';
import { StreamingText } from './StreamingText';
import { CtaButtonGroup } from './CtaButtonGroup';
import { HIDE_STREAMING_XML_TAGS } from '@/components/thread/utils';
import ToolCallInline from '@/components/thread/tool-inline/ToolCallInline';
import { parseInlineToolExecutions } from '@/components/thread/tool-inline/parse-inline-json';
import { summarize, type ToolExecution } from '@/components/thread/tool-inline/summarizers';
import { cn } from '@/lib/utils';
import { SelectionMarkerOverlay } from './SelectionMarkerOverlay';
import { SelectionAddToCanvasButton } from './SelectionAddToCanvasButton';
import {
    ResearchPublicationCard,
    type ResearchPublicationPayload,
    type ResearchVerificationPayload,
} from './ResearchPublicationCard';
import {
    ResearchPlanCard,
    type ResearchPlanPayload,
} from './ResearchPlanCard';
import { CanvasPreviewCard } from './CanvasPreviewCard';
import { fetchMyRoles } from '@/lib/backend-api';

const BASE_MARKDOWN_CLASSNAME =
    'text-base prose dark:prose-invert chat-markdown max-w-none break-words';
const STREAMING_MARKDOWN_CLASSNAME =
    'text-base prose dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-wrap-anywhere';
const USER_MESSAGE_COLLAPSE_LINES = 6;
const USER_MESSAGE_DEFAULT_LINE_HEIGHT_PX = 24;
const USER_MESSAGE_COLLAPSE_BUFFER_PX = 2;

const ZmindWordmark: React.FC<{ className?: string }> = ({ className }) => (
    <div className={cn('flex items-center', className)}>
        <Image
            src="/zmind-logo.svg"
            alt="Zmind"
            width={80}
            height={20}
            className="h-5 w-auto dark:hidden"
        />
        <Image
            src="/zmind-logo-white.svg"
            alt="Zmind"
            width={80}
            height={20}
            className="hidden h-5 w-auto dark:block"
        />
    </div>
);

type AttachmentDisplay = string | {
    fileId?: string;
    path: string;
    name?: string;
    size?: number;
    type?: string;
    fileUrl?: string;
    downloadUrl?: string;
    localUrl?: string;
};

// Helper function to render all attachments as standalone messages
export function renderStandaloneAttachments(
    attachments: AttachmentDisplay[],
    fileViewerHandler?: (filePath?: string, filePathList?: string[], file?: any) => void,
    sandboxId?: string,
    project?: Project,
    alignRight: boolean = false,
    shareThreadId?: string,
) {
    if (!attachments || attachments.length === 0) return null;
    // Render compact chips above the user message bubble, aligned with user side
    return (
        <FileAttachmentGrid
            attachments={attachments}
            onFileClick={fileViewerHandler}
            sandboxId={sandboxId}
            project={project}
            // Use collapsed chips (no large previews)
            collapsed={true}
            showPreviews={true}
            standalone={false}
            alignRight={alignRight}
            shareThreadId={shareThreadId}
        />
    );
}

// Helper function for legacy compatibility (now just returns null since all files are standalone)
export function renderAttachments(
    attachments: AttachmentDisplay[],
    fileViewerHandler?: (filePath?: string, filePathList?: string[], file?: any) => void,
    sandboxId?: string,
    project?: Project
) {
    // Keep inner-bubble attachments hidden to avoid duplication
    return null;
}

function extractLegacyAttachmentsFromContent(content: string): string[] {
    if (!content) return [];
    const attachmentsMatch = content.match(/\[Uploaded File: (.*?)\]/g);
    if (!attachmentsMatch) return [];
    return attachmentsMatch
        .map((match: string) => {
            const pathMatch = match.match(/\[Uploaded File: (.*?)\]/);
            return pathMatch ? pathMatch[1] : null;
        })
        .filter(Boolean) as string[];
}

function normalizeMetadataAttachments(meta?: ParsedMetadata | null): AttachmentDisplay[] {
    const raw = meta?.attachments;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((att: any) => {
            if (!att || typeof att !== 'object') return null;
            const fileId = att.file_id || att.fileId || att.id;
            const name = att.name || att.filename || att.original_filename;
            const size = att.size ?? att.file_size;
            const type = att.content_type || att.mime_type;
            const path = att.storage_path || fileId || name;
            if (!path && !fileId) return null;
            return {
                fileId: typeof fileId === 'string' ? fileId : undefined,
                name: typeof name === 'string' ? name : undefined,
                size: typeof size === 'number' ? size : undefined,
                type: typeof type === 'string' ? type : undefined,
                path: typeof path === 'string' ? path : String(path),
            };
        })
        .filter(Boolean) as AttachmentDisplay[];
}

function mergeAttachments(
    metaAttachments: AttachmentDisplay[],
    legacyAttachments: string[],
): AttachmentDisplay[] {
    const seen = new Set<string>();
    const combined: AttachmentDisplay[] = [];

    metaAttachments.forEach((att) => {
        const key = typeof att === 'string' ? att : att.fileId || att.path || att.name || '';
        if (!key || seen.has(key)) return;
        seen.add(key);
        combined.push(att);
    });

    legacyAttachments.forEach((path) => {
        const key = path || '';
        if (!key || seen.has(key)) return;
        seen.add(key);
        combined.push(path);
    });

    return combined;
}

function toObjectRecord(value: any): Record<string, any> | null {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, any>;
            }
            return null;
        } catch {
            return null;
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
    }
    return null;
}

function normalizeCanvasPreview(value: any): CanvasPreviewMessage | null {
    const direct = toObjectRecord(value);
    if (!direct) return null;
    const wrapped = toObjectRecord(direct.preview);
    const candidate =
        wrapped && (direct.version || direct.title || direct.summary)
            ? wrapped
            : direct;
    if (!candidate.plan_id && !candidate.planId) return null;
    return {
        plan_id: String(candidate.plan_id || candidate.planId || ''),
        user_goal: typeof candidate.user_goal === 'string' ? candidate.user_goal : candidate.userGoal,
        target_canvas_id:
            typeof candidate.target_canvas_id === 'string'
                ? candidate.target_canvas_id
                : candidate.targetCanvasId || null,
        selection_scope:
            typeof candidate.selection_scope === 'string'
                ? candidate.selection_scope
                : candidate.selectionScope,
        impacted_node_ids: Array.isArray(candidate.impacted_node_ids)
            ? candidate.impacted_node_ids
            : Array.isArray(candidate.impactedNodeIds)
              ? candidate.impactedNodeIds
              : [],
        impacted_connection_ids: Array.isArray(candidate.impacted_connection_ids)
            ? candidate.impacted_connection_ids
            : Array.isArray(candidate.impactedConnectionIds)
              ? candidate.impactedConnectionIds
              : [],
        impacted_regions: Array.isArray(candidate.impacted_regions)
            ? candidate.impacted_regions
            : Array.isArray(candidate.impactedRegions)
              ? candidate.impactedRegions
              : [],
        operation_summary: toObjectRecord(candidate.operation_summary) || toObjectRecord(candidate.operationSummary) || {},
        risk_level:
            typeof candidate.risk_level === 'string'
                ? candidate.risk_level
                : candidate.riskLevel,
        expected_canvas_version:
            typeof candidate.expected_canvas_version === 'number'
                ? candidate.expected_canvas_version
                : typeof candidate.expectedCanvasVersion === 'number'
                  ? candidate.expectedCanvasVersion
                  : null,
        verification_summary:
            toObjectRecord(candidate.verification_summary) || toObjectRecord(candidate.verificationSummary) || {},
        resume_token:
            typeof candidate.resume_token === 'string'
                ? candidate.resume_token
                : candidate.resumeToken,
        confirm_token:
            typeof candidate.confirm_token === 'string'
                ? candidate.confirm_token
                : candidate.confirmToken,
        pending_plan_ref:
            typeof candidate.pending_plan_ref === 'string'
                ? candidate.pending_plan_ref
                : candidate.pendingPlanRef,
        planning_summary: toObjectRecord(candidate.planning_summary) || toObjectRecord(candidate.planningSummary) || {},
    };
}

function extractDeepResearchOutput(rawOutput: any): Record<string, any> | null {
    const direct = toObjectRecord(rawOutput);
    if (!direct) return null;
    const candidates = [direct, toObjectRecord(direct.output), toObjectRecord(direct.payload)].filter(Boolean) as Record<string, any>[];
    for (const candidate of candidates) {
        const agent = typeof candidate.agent === 'string' ? candidate.agent.trim() : '';
        if (agent === 'deep_research_agent' || candidate.publication || candidate.verification) {
            return candidate;
        }
    }
    return null;
}

type ResearchPublicationSnapshot = {
    publication: ResearchPublicationPayload;
    verification?: ResearchVerificationPayload;
};

function extractResearchPublicationSnapshot(toolExec: ToolExecution | null | undefined): ResearchPublicationSnapshot | null {
    if (!toolExec) return null;
    const functionName = String(toolExec.function_name || toolExec.xml_tag_name || '').toLowerCase();
    const output = extractDeepResearchOutput(toolExec.result?.output);
    if (!output) return null;
    const agent = typeof output.agent === 'string' ? output.agent.trim() : '';
    const fromResearchHandoff =
        functionName.includes('transfer_to_deep_research_agent') ||
        functionName.includes('transfer-to-deep-research-agent') ||
        agent === 'deep_research_agent';
    if (!fromResearchHandoff && !output.publication) {
        return null;
    }

    const publication = toObjectRecord(output.publication);
    if (!publication) return null;
    const verification = toObjectRecord(output.verification);
    return {
        publication: publication as ResearchPublicationPayload,
        verification: verification as ResearchVerificationPayload | undefined,
    };
}

function extractResearchPlanSnapshot(toolExec: ToolExecution | null | undefined): ResearchPlanPayload | null {
    if (!toolExec) return null;
    const functionName = String(toolExec.function_name || toolExec.xml_tag_name || '').toLowerCase();
    const output = extractDeepResearchOutput(toolExec.result?.output);
    if (!output) return null;
    const agent = typeof output.agent === 'string' ? output.agent.trim() : '';
    const fromResearchHandoff =
        functionName.includes('transfer_to_deep_research_agent') ||
        functionName.includes('transfer-to-deep-research-agent') ||
        agent === 'deep_research_agent';
    if (!fromResearchHandoff) return null;

    if (output.status === 'plan_generated' || (output.plan && typeof output.plan === 'object')) {
        const plan = (output.plan || output) as Record<string, any>;
        if (plan.status !== 'plan_generated' && output.status === 'plan_generated') {
            plan.status = 'plan_generated';
        }
        return plan as ResearchPlanPayload;
    }
    return null;
}

// Render Markdown content while preserving XML tags that should be displayed as tool calls
function preprocessTextOnlyTools(content: string): string {
    
    // Handle new function calls format for text-only tools - extract text parameter content
    // Complete XML format
    content = content.replace(/<function_calls>\s*<invoke name="ask">\s*<parameter name="text">([\s\S]*?)<\/parameter>[\s\S]*?<\/invoke>\s*<\/function_calls>/gi, '$1');
    content = content.replace(/<function_calls>\s*<invoke name="complete">\s*<parameter name="text">([\s\S]*?)<\/parameter>[\s\S]*?<\/invoke>\s*<\/function_calls>/gi, '$1');
    
    // Handle streaming/partial XML for message tools - extract text parameter content even if incomplete
    content = content.replace(/<function_calls>\s*<invoke name="ask">\s*<parameter name="text">([\s\S]*?)$/gi, '$1');
    content = content.replace(/<function_calls>\s*<invoke name="complete">\s*<parameter name="text">([\s\S]*?)$/gi, '$1');
    
    // Also handle old format for backward compatibility
    content = content.replace(/<ask[^>]*>([\s\S]*?)<\/ask>/gi, '$1');
    content = content.replace(/<complete[^>]*>([\s\S]*?)<\/complete>/gi, '$1');  
    content = content.replace(/<input_images[\s\S]*?<\/input_images>/gi, '');
    return content;
}

type MarkdownSegment = {
    type: 'text' | 'code';
    value: string;
};

function splitInlineCodeSegments(text: string): MarkdownSegment[] {
    const segments: MarkdownSegment[] = [];
    const inlineCodeRegex = /(`+)([^`\n]+?)\1/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlineCodeRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        segments.push({ type: 'code', value: match[0] });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        segments.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return segments;
}

function splitMarkdownSegments(content: string): MarkdownSegment[] {
    const segments: MarkdownSegment[] = [];
    const lines = content.split('\n');
    let buffer = '';
    let inFence = false;
    let fenceChar: '`' | '~' | null = null;
    let fenceLength = 0;

    const flushBuffer = () => {
        if (!buffer) return;
        if (inFence) {
            segments.push({ type: 'code', value: buffer });
        } else {
            segments.push(...splitInlineCodeSegments(buffer));
        }
        buffer = '';
    };

    lines.forEach((line, index) => {
        const isLast = index === lines.length - 1;
        const lineWithBreak = isLast ? line : `${line}\n`;
        const fenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);

        if (!inFence) {
            if (fenceMatch) {
                flushBuffer();
                inFence = true;
                fenceChar = fenceMatch[2][0] as '`' | '~';
                fenceLength = fenceMatch[2].length;
                buffer += lineWithBreak;
                return;
            }
            buffer += lineWithBreak;
            return;
        }

        buffer += lineWithBreak;
        if (fenceMatch) {
            const marker = fenceMatch[2];
            if (marker[0] === fenceChar && marker.length >= fenceLength) {
                flushBuffer();
                inFence = false;
                fenceChar = null;
                fenceLength = 0;
            }
        }
    });

    if (buffer) {
        if (inFence) {
            segments.push({ type: 'code', value: buffer });
        } else {
            segments.push(...splitInlineCodeSegments(buffer));
        }
    }

    return segments;
}

function escapeXmlTag(tag: string) {
    return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLegacyToolExecution(toolName: string, rawXml: string): ToolExecution {
    const normalizedName = toolName?.trim() || 'tool';
    const attrs: Record<string, string> = {};
    const attrRegex = /([A-Za-z0-9_\-:]+)=["']([^"']+)["']/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawXml)) !== null) {
        const key = attrMatch[1];
        const value = attrMatch[2];
        if (key) {
            attrs[key] = value;
        }
    }

    const tagPattern = new RegExp(`<${escapeXmlTag(normalizedName)}[^>]*>([\\s\\S]*?)<\\/${escapeXmlTag(normalizedName)}>`, 'i');
    const bodyMatch = rawXml.match(tagPattern);
    const innerContent = bodyMatch ? bodyMatch[1].trim() : '';
    let parsedInner: any = undefined;
    if (innerContent) {
        try {
            parsedInner = JSON.parse(innerContent);
        } catch {
            const stripped = innerContent.replace(/<[^>]+>/g, '').trim();
            parsedInner = stripped || innerContent;
        }
    }

    let mergedArgs: Record<string, any> | undefined = undefined;
    if (parsedInner && typeof parsedInner === 'object' && !Array.isArray(parsedInner)) {
        mergedArgs = { ...attrs, ...parsedInner };
    } else if (parsedInner !== undefined) {
        mergedArgs = { ...attrs, text: parsedInner };
    } else if (Object.keys(attrs).length > 0) {
        mergedArgs = attrs;
    }

    return {
        function_name: normalizedName.includes('-') ? normalizedName.replace(/-/g, '_') : normalizedName,
        xml_tag_name: normalizedName.replace(/_/g, '-'),
        arguments: mergedArgs,
        result: {
            output: parsedInner ?? (Object.keys(attrs).length ? attrs : rawXml),
        },
    };
}

export function renderMarkdownContent(
    content: string,
    handleToolClick: (assistantMessageId: string | null, toolName: string) => void,
    messageId: string | null,
    fileViewerHandler?: (filePath?: string, filePathList?: string[]) => void,
    sandboxId?: string,
    project?: Project,
    debugMode?: boolean,
    shareThreadId?: string,
    markdownClassName?: string,
) {
    // Preprocess content to convert text-only tools to natural text
    content = preprocessTextOnlyTools(content);
    
    // If in debug mode, just display raw content in a pre tag
    if (debugMode) {
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30 text-foreground">
                {content}
            </pre>
        );
    }

    const buildMarkdownClassName = (extra?: string) =>
        cn(BASE_MARKDOWN_CLASSNAME, extra, markdownClassName);

    const renderXmlAwareContent = (segment: string): React.ReactNode => {
        if (isNewXmlFormat(segment)) {
            const contentParts: React.ReactNode[] = [];
            let lastIndex = 0;

            // Find all function_calls blocks
            const functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
            let match: RegExpExecArray | null = null;

            while ((match = functionCallsRegex.exec(segment)) !== null) {
                // Add text before the function_calls block
                if (match.index > lastIndex) {
                    const textBeforeBlock = segment.substring(lastIndex, match.index);
                    if (textBeforeBlock.trim()) {
                        contentParts.push(
                            <ComposioUrlDetector
                                key={`md-${lastIndex}`}
                                content={textBeforeBlock}
                                className={buildMarkdownClassName()}
                            />
                        );
                    }
                }

                // Parse the tool calls in this block
                const toolCalls = parseXmlToolCalls(match[0]);

                toolCalls.forEach((toolCall, index) => {
                    const toolName = toolCall.functionName.replace(/_/g, '-');

                    if (toolName === 'ask') {
                        const askText = toolCall.parameters.text || '';
                        const attachments = toolCall.parameters.attachments || [];
                        const attachmentArray = Array.isArray(attachments)
                            ? attachments
                            : typeof attachments === 'string'
                                ? attachments.split(',').map((a) => a.trim())
                                : [];

                        contentParts.push(
                            <div key={`ask-${match.index}-${index}`} className="space-y-2">
                                <ComposioUrlDetector
                                    content={askText}
                                    className={buildMarkdownClassName('[&>:first-child]:mt-0 prose-headings:mt-3')}
                                />
                                {renderAttachments(attachmentArray, fileViewerHandler, sandboxId, project)}
                            </div>
                        );
                    } else if (toolName === 'complete') {
                        const completeText = toolCall.parameters.text || '';
                        const attachments = toolCall.parameters.attachments || '';
                        const attachmentArray = Array.isArray(attachments)
                            ? attachments
                            : typeof attachments === 'string'
                                ? attachments.split(',').map((a) => a.trim())
                                : [];

                        contentParts.push(
                            <div key={`complete-${match.index}-${index}`} className="space-y-2">
                                <ComposioUrlDetector
                                    content={completeText}
                                    className={buildMarkdownClassName('[&>:first-child]:mt-0 prose-headings:mt-3')}
                                />
                                {renderAttachments(attachmentArray, fileViewerHandler, sandboxId, project)}
                            </div>
                        );
                    } else {
                        const exec: ToolExecution = {
                            function_name: toolCall.rawFunctionName || toolName,
                            xml_tag_name: toolCall.functionName || toolName,
                            arguments: toolCall.parameters,
                            result: {
                                output: toolCall.parameters,
                            },
                        };

                        contentParts.push(
                            <div key={`tool-inline-${match.index}-${index}`} className="my-1">
                                <ToolCallInline exec={exec} insetRightPx={16} />
                            </div>
                        );
                    }
                });

                lastIndex = match.index + match[0].length;
            }

            // Add any remaining text after the last function_calls block
            if (lastIndex < segment.length) {
                const remainingText = segment.substring(lastIndex);
                if (remainingText.trim()) {
                    contentParts.push(
                        <ComposioUrlDetector
                            key={`md-${lastIndex}`}
                            content={remainingText}
                            className={buildMarkdownClassName()}
                        />
                    );
                }
            }

            return contentParts.length > 0 ? contentParts : (
                <ComposioUrlDetector content={segment} className={buildMarkdownClassName()} />
            );
        }

        // Fall back to old XML format handling
        const xmlRegex = /<(?!inform\b)([a-zA-Z\-_]+)(?:\s+[^>]*)?>(?:[\s\S]*?)<\/\1>|<(?!inform\b)([a-zA-Z\-_]+)(?:\s+[^>]*)?\/>/g;
        let lastIndex = 0;
        const contentParts: React.ReactNode[] = [];
        let match: RegExpExecArray | null = null;

        // If no XML tags found, just return the full content as markdown
        if (!segment.match(xmlRegex)) {
            return <ComposioUrlDetector content={segment} className={buildMarkdownClassName()} />;
        }

        while ((match = xmlRegex.exec(segment)) !== null) {
            // Add text before the tag as markdown
            if (match.index > lastIndex) {
                const textBeforeTag = segment.substring(lastIndex, match.index);
                contentParts.push(
                    <ComposioUrlDetector
                        key={`md-${lastIndex}`}
                        content={textBeforeTag}
                        className={buildMarkdownClassName('inline-block mr-1')}
                    />
                );
            }

            const rawXml = match[0];
            const toolName = match[1] || match[2];
            const toolCallKey = `tool-${match.index}`;

            if (toolName === 'ask') {
                // Extract attachments from the XML attributes
                const attachmentsMatch = rawXml.match(/attachments=["']([^"']*)["']/i);
                const attachments = attachmentsMatch
                    ? attachmentsMatch[1].split(',').map(a => a.trim())
                    : [];

                // Extract content from the ask tag
                const contentMatch = rawXml.match(/<ask[^>]*>([\s\S]*?)<\/ask>/i);
                const askContent = contentMatch ? contentMatch[1] : '';

                // Render <ask> tag content with attachment UI (using the helper)
                contentParts.push(
                    <div key={`ask-${match.index}`} className="space-y-3">
                        <ComposioUrlDetector
                            content={askContent}
                            className={buildMarkdownClassName('[&>:first-child]:mt-0 prose-headings:mt-3')}
                        />
                        {renderAttachments(attachments, fileViewerHandler, sandboxId, project)}
                    </div>
                );
                
                // Also render standalone attachments outside the message
                const standaloneAttachments = renderStandaloneAttachments(attachments, fileViewerHandler, sandboxId, project, false, shareThreadId);
                if (standaloneAttachments) {
                    contentParts.push(
                        <div key={`ask-attachments-${match.index}`}>
                            {standaloneAttachments}
                        </div>
                    );
                }
            } else if (toolName === 'complete') {
                // Extract attachments from the XML attributes
                const attachmentsMatch = rawXml.match(/attachments=["']([^"']*)["']/i);
                const attachments = attachmentsMatch
                    ? attachmentsMatch[1].split(',').map(a => a.trim())
                    : [];

                // Extract content from the complete tag
                const contentMatch = rawXml.match(/<complete[^>]*>([\s\S]*?)<\/complete>/i);
                const completeContent = contentMatch ? contentMatch[1] : '';

                // Render <complete> tag content with attachment UI (using the helper)
                contentParts.push(
                    <div key={`complete-${match.index}`} className="space-y-3">
                        <ComposioUrlDetector
                            content={completeContent}
                            className={buildMarkdownClassName('[&>:first-child]:mt-0 prose-headings:mt-3')}
                        />
                        {renderAttachments(attachments, fileViewerHandler, sandboxId, project)}
                    </div>
                );
                
                // Also render standalone attachments outside the message
                const standaloneAttachments = renderStandaloneAttachments(attachments, fileViewerHandler, sandboxId, project, false, shareThreadId);
                if (standaloneAttachments) {
                    contentParts.push(
                        <div key={`complete-attachments-${match.index}`}>
                            {standaloneAttachments}
                        </div>
                    );
                }
            } else {
                const exec = buildLegacyToolExecution(toolName, rawXml);
                contentParts.push(
                    <div key={`tool-inline-${toolCallKey}`} className="my-1">
                        <ToolCallInline exec={exec} insetRightPx={16} />
                    </div>
                );
            }
            lastIndex = xmlRegex.lastIndex;
        }

        // Add text after the last tag
        if (lastIndex < segment.length) {
            contentParts.push(
                <ComposioUrlDetector
                    key={`md-${lastIndex}`}
                    content={segment.substring(lastIndex)}
                    className={buildMarkdownClassName()}
                />
            );
        }

        return contentParts;
    };

    const segments = splitMarkdownSegments(content);
    const hasCodeSegments = segments.some((seg) => seg.type === 'code');

    if (hasCodeSegments) {
        const nodes: React.ReactNode[] = [];
        segments.forEach((seg, index) => {
            if (!seg.value) return;
            if (seg.type === 'code') {
                nodes.push(
                    <ComposioUrlDetector
                        key={`md-code-${index}`}
                        content={seg.value}
                        className={buildMarkdownClassName()}
                    />
                );
                return;
            }
            const rendered = renderXmlAwareContent(seg.value);
            nodes.push(
                <React.Fragment key={`md-text-${index}`}>
                    {rendered}
                </React.Fragment>
            );
        });
        return nodes;
    }

    return renderXmlAwareContent(content);
}

// New helper: render content but replace inline tool_execution JSON with inline tool bars
function renderContentWithInlineTools(
    content: string,
    handleToolClick: (assistantMessageId: string | null, toolName: string) => void,
    messageId: string | null,
    fileViewerHandler?: (filePath?: string, filePathList?: string[]) => void,
    sandboxId?: string,
    project?: Project,
    debugMode?: boolean,
    shareThreadId?: string,
    markdownClassName?: string,
) {
    const segments = parseInlineToolExecutions(content);
    if (segments.length === 0) {
        return renderMarkdownContent(
            content,
            handleToolClick,
            messageId,
            fileViewerHandler,
            sandboxId,
            project,
            debugMode,
            shareThreadId,
            markdownClassName,
        );
    }
    const nodes: React.ReactNode[] = [];
    segments.forEach((seg, idx) => {
        if (seg.type === 'text') {
            const part = renderMarkdownContent(
                seg.text,
                handleToolClick,
                messageId,
                fileViewerHandler,
                sandboxId,
                project,
                debugMode,
                shareThreadId,
                markdownClassName,
            );
            // Wrap in a real element to prevent React flattening and key collisions
            nodes.push(<div key={`seg-text-${idx}`}>{part}</div>);
        } else if (seg.type === 'tool') {
            nodes.push(
                <div key={`inline-tool-${idx}`} className="my-1">
                    <ToolCallInline exec={seg.exec} insetRightPx={16} />
                </div>
            );
        }
    });
    return nodes;
}

// Helper: render streaming text but replace inline tool_execution JSON with inline bars
function renderStreamingWithInlineTools(text: string, markdownClassName?: string): React.ReactNode {
    const segments = parseInlineToolExecutions(text || '');
    const className = cn(STREAMING_MARKDOWN_CLASSNAME, markdownClassName);
    if (segments.length === 0) {
        return (
            <StreamingText 
                content={text} 
                className={className}
            />
        );
    }
    const nodes: React.ReactNode[] = [];
    segments.forEach((seg, idx) => {
        if (seg.type === 'text') {
            nodes.push(
                <StreamingText 
                    key={`stream-seg-${idx}`}
                    content={seg.text}
                    className={className}
                />
            );
        } else {
            nodes.push(
                <div key={`stream-inline-tool-${idx}`} className="my-1">
                    <ToolCallInline exec={seg.exec} insetRightPx={16} />
                </div>
            );
        }
    });
    return nodes;
}

const CTA_STYLES = new Set(['primary', 'secondary', 'danger']);

function normalizeCtaButtons(value: unknown): CtaAction[] {
    if (!Array.isArray(value)) return [];
    const out: CtaAction[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const label = typeof raw.label === 'string' ? raw.label.trim() : '';
        const action = typeof raw.action === 'string' ? raw.action.trim() : '';
        if (!label || !action) continue;
        const style = typeof raw.style === 'string' && CTA_STYLES.has(raw.style) ? (raw.style as CtaAction['style']) : undefined;
        out.push({
            label,
            action,
            payload: raw.payload,
            style,
            icon: typeof raw.icon === 'string' ? raw.icon.trim() : undefined,
            description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
        });
    }
    return out;
}

type RunTimeMode = 'working' | 'done';

const formatRunDuration = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h${minutes}m`;
    if (minutes > 0) return `${minutes}m${seconds}s`;
    return `${seconds}s`;
};

const buildRunLabel = (
    locale: string,
    mode: RunTimeMode,
    durationMs: number,
    status?: string,
): string => {
    const isZh = locale.toLowerCase().startsWith('zh');
    const duration = formatRunDuration(durationMs);
    if (mode === 'working') {
        return isZh ? `处理中(${duration})` : `working (${duration})`;
    }
    const base = isZh ? `用时${duration}` : `worked for ${duration}`;
    if (!status) return base;
    if (status === 'failed' || status === 'error') {
        return isZh ? `${base}·失败` : `${base} · failed`;
    }
    if (status === 'stopped') {
        return isZh ? `${base}·停止` : `${base} · stopped`;
    }
    return base;
};

const RunTimeLabel: React.FC<{
    locale: string;
    mode: RunTimeMode;
    startedAt?: string | null;
    elapsedMs?: number | null;
    status?: string;
}> = ({ locale, mode, startedAt, elapsedMs, status }) => {
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (mode !== 'working' || !startedAt) return;
        const id = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [mode, startedAt]);

    if (mode === 'working') {
        if (!startedAt) return null;
        const started = Date.parse(startedAt);
        if (!Number.isFinite(started)) return null;
        const durationMs = nowMs - started;
        if (!Number.isFinite(durationMs) || durationMs < 0) return null;
        return (
            <AnimatedShinyText
                shimmerWidth={80}
                className="ml-3 mr-0 max-w-none text-xs whitespace-nowrap text-muted-foreground bg-gradient-to-r from-transparent via-foreground/70 to-transparent dark:via-foreground/70"
            >
                {buildRunLabel(locale, mode, durationMs)}
            </AnimatedShinyText>
        );
    }

    if (!elapsedMs || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
    return (
        <span className="ml-3 text-xs text-muted-foreground">
            {buildRunLabel(locale, mode, elapsedMs, status)}
        </span>
    );
};

const CollapsibleUserMessage: React.FC<{
    locale: string;
    contentKey: string;
    children: React.ReactNode;
}> = ({ locale, contentKey, children }) => {
    const estimatedCollapsible = React.useMemo(() => {
        const normalizedContent = (contentKey || '').trim();
        if (!normalizedContent) return false;
        const hardBreakLines = normalizedContent.split(/\r?\n/).length;
        if (hardBreakLines > USER_MESSAGE_COLLAPSE_LINES) return true;
        return normalizedContent.length > 120;
    }, [contentKey]);

    const [isExpanded, setIsExpanded] = useState(false);
    const [isCollapsible, setIsCollapsible] = useState(estimatedCollapsible);
    const [maxHeightPx, setMaxHeightPx] = useState(
        USER_MESSAGE_COLLAPSE_LINES * USER_MESSAGE_DEFAULT_LINE_HEIGHT_PX,
    );
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsExpanded(false);
        setIsCollapsible(estimatedCollapsible);
    }, [contentKey, estimatedCollapsible]);

    useEffect(() => {
        const node = bodyRef.current;
        if (!node) return;

        let frameId = 0;
        const measure = () => {
            const computedLineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight);
            const lineHeightPx = Number.isFinite(computedLineHeight)
                ? computedLineHeight
                : USER_MESSAGE_DEFAULT_LINE_HEIGHT_PX;
            const collapsedHeightPx = lineHeightPx * USER_MESSAGE_COLLAPSE_LINES;

            setMaxHeightPx(collapsedHeightPx);
            const shouldCollapseByHeight = node.scrollHeight > collapsedHeightPx + USER_MESSAGE_COLLAPSE_BUFFER_PX;
            setIsCollapsible(estimatedCollapsible || shouldCollapseByHeight);
        };

        const scheduleMeasure = () => {
            window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(measure);
        };

        scheduleMeasure();

        if (typeof ResizeObserver === 'undefined') {
            return () => {
                window.cancelAnimationFrame(frameId);
            };
        }

        const observer = new ResizeObserver(() => {
            scheduleMeasure();
        });
        observer.observe(node);

        return () => {
            window.cancelAnimationFrame(frameId);
            observer.disconnect();
        };
    }, [contentKey, estimatedCollapsible]);

    const isZh = locale.toLowerCase().startsWith('zh');
    const toggleLabel = isExpanded ? (isZh ? '收起' : 'Collapse') : (isZh ? '展开全文' : 'Show more');

    return (
        <div className="space-y-1">
            <div
                className={cn('relative min-w-0', !isExpanded && isCollapsible ? 'overflow-hidden' : '')}
                style={!isExpanded && isCollapsible ? { maxHeight: `${maxHeightPx}px` } : undefined}
            >
                <div ref={bodyRef} className="min-w-0">
                    {children}
                </div>
                {!isExpanded && isCollapsible && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card via-card/80 to-transparent" />
                )}
            </div>
            {isCollapsible && (
                <button
                    type="button"
                    onClick={() => setIsExpanded((previous) => !previous)}
                    aria-expanded={isExpanded}
                    className="self-end text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                    {toggleLabel}
                </button>
            )}
        </div>
    );
};

export interface ThreadContentProps {
    messages: UnifiedMessage[];
    streamingReasoningContent?: string;
    streamingToolCall?: any;
    agentStatus: 'idle' | 'running' | 'connecting' | 'error';
    handleToolClick: (assistantMessageId: string | null, toolName: string) => void;
    handleOpenFileViewer: (filePath?: string, filePathList?: string[], file?: any) => void;
    readOnly?: boolean;
    // When true, show loader even if readOnly is true (canvas panel needs this)
    forceShowLoader?: boolean;
    visibleMessages?: UnifiedMessage[]; // For playback mode
    streamingText?: string; // For playback mode
    isStreamingText?: boolean; // For playback mode
    currentToolCall?: any; // For playback mode
    streamHookStatus?: string; // Add this prop
    sandboxId?: string; // Add sandboxId prop
    project?: Project; // Add project prop
    debugMode?: boolean; // Add debug mode parameter
    isPreviewMode?: boolean;
    showStreamingTools?: boolean;
    assistantMarkdownClassName?: string;
    agentName?: string;
    agentAvatar?: React.ReactNode;
    emptyStateComponent?: React.ReactNode; // Add custom empty state component prop
    threadMetadata?: any; // Add thread metadata prop
    agentMetadata?: any; // Add agent metadata prop
    agentData?: any; // Add full agent data prop
    shareThreadId?: string; // For public share pages, media proxy auth
    hasStreamingAssistant?: boolean;
    showResponseTime?: boolean;
    runStartedAt?: string | null;
    onCtaAction?: (cta: CtaAction) => void;
}

export const ThreadContent: React.FC<ThreadContentProps> = ({
    messages,
    streamingReasoningContent = "",
    streamingToolCall,
    agentStatus,
    handleToolClick,
    handleOpenFileViewer,
    readOnly = false,
    forceShowLoader = false,
    visibleMessages,
    streamingText = "",
    isStreamingText = false,
    currentToolCall,
    streamHookStatus = "idle",
    sandboxId,
    project,
    debugMode = false,
    isPreviewMode = false,
    showStreamingTools = true,
    assistantMarkdownClassName,
    agentName = 'Zmind',
    agentAvatar = <ZmindLogo size={16} />,
    emptyStateComponent,
    threadMetadata,
    agentMetadata,
    agentData,
    shareThreadId,
    hasStreamingAssistant = false,
    showResponseTime = false,
    runStartedAt = null,
    onCtaAction,
}) => {
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const latestMessageRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const { session } = useAuth();
    const locale = useLocale();
    const router = useRouter();
    const [isAdmin, setIsAdmin] = useState(false);

    // React Query file preloader
    const { preloadFiles } = useFilePreloader();

    useEffect(() => {
        let mounted = true;
        const userId = session?.user?.id;
        if (!userId) {
            setIsAdmin(false);
            return () => {
                mounted = false;
            };
        }
        (async () => {
            try {
                // 权限由服务端判定：前端不再直查 user_roles 表
                const roles = await fetchMyRoles();
                if (mounted) setIsAdmin(roles.is_admin);
            } catch {
                if (mounted) setIsAdmin(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [session?.user?.id]);

    const containerClassName = isPreviewMode
        ? "flex-1 overflow-y-auto scrollbar-thin scrollbar-track-secondary/0 scrollbar-thumb-primary/10 scrollbar-thumb-rounded-full hover:scrollbar-thumb-primary/10 py-4 pb-0"
        : "flex-1 overflow-y-auto scrollbar-thin scrollbar-track-secondary/0 scrollbar-thumb-primary/10 scrollbar-thumb-rounded-full hover:scrollbar-thumb-primary/10 py-4 pb-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60";

    // In playback mode, we use visibleMessages instead of messages
    const displayMessages = readOnly && visibleMessages ? visibleMessages : messages;
    const isStreamingMessage = useCallback((msg: UnifiedMessage) => {
        if (!msg || msg.type !== 'assistant') return false;
        const meta = safeJsonParse<ParsedMetadata>(msg.metadata, {});
        if (meta?.streaming === true) return true;
        if (meta?.stream_status === 'chunk') return true;
        return false;
    }, []);
    const isCanvasToolName = useCallback((name: string) => {
        const normalized = (name || '').trim();
        return normalized.startsWith('canvas_') || normalized === 'transfer_to_canvas_agent';
    }, []);
    const hasAssistantMessages = React.useMemo(
        () => displayMessages.some((msg) => msg.type === 'assistant'),
        [displayMessages],
    );
    const hasStreamingReasoning = Boolean(streamingReasoningContent && streamingReasoningContent.length > 0);
    const hasStreamingSeenRef = useRef(false);
    const isAgentActive =
        agentStatus === 'running' ||
        agentStatus === 'connecting' ||
        streamHookStatus === 'streaming' ||
        streamHookStatus === 'connecting';
    const shouldShowLoader = forceShowLoader || (!readOnly && isAgentActive);
    useEffect(() => {
        if (hasStreamingAssistant) {
            hasStreamingSeenRef.current = true;
        }
        if (!shouldShowLoader) {
            hasStreamingSeenRef.current = false;
        }
    }, [hasStreamingAssistant, shouldShowLoader]);
    const showWarmupLoader =
        shouldShowLoader && !hasStreamingAssistant && !hasStreamingSeenRef.current && !hasStreamingReasoning;
    const showStreamingDot = shouldShowLoader && (hasStreamingAssistant || hasStreamingSeenRef.current);
    const isLiveStreaming =
        forceShowLoader ||
        isAgentActive ||
        hasStreamingAssistant;
    const allowCopyWhileStreaming = readOnly && !forceShowLoader;
    const canvasProgressHint = React.useMemo(() => {
        if (streamHookStatus !== 'streaming') return '';
        const toolName = (streamingToolCall?.name || streamingToolCall?.function_name || streamingToolCall?.xml_tag_name || '').trim();
        if (toolName && isCanvasToolName(toolName)) {
            return '正在更新画布…';
        }
        return '';
    }, [streamHookStatus, streamingToolCall, isCanvasToolName]);
    const renderStreamingAssistantContent = useCallback(
        (rawContent: string, messageId: string | null) => {
            if (debugMode) {
                return (
                    <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                        {rawContent}
                    </pre>
                );
            }
            const textToRender = preprocessTextOnlyTools(rawContent || '');
            if (!textToRender) return null;

            let detectedTag: string | null = null;
            let tagStartIndex = -1;
            const functionCallsIndex = textToRender.indexOf('<function_calls>');
            if (functionCallsIndex !== -1) {
                detectedTag = 'function_calls';
                tagStartIndex = functionCallsIndex;
            } else {
                for (const tag of HIDE_STREAMING_XML_TAGS) {
                    const openingTagPattern = `<${tag}`;
                    const index = textToRender.indexOf(openingTagPattern);
                    if (index !== -1) {
                        detectedTag = tag;
                        tagStartIndex = index;
                        break;
                    }
                }
            }

            const textBeforeTag = detectedTag ? textToRender.substring(0, tagStartIndex) : textToRender;
            return (
                <>
                    {renderStreamingWithInlineTools(textBeforeTag, assistantMarkdownClassName)}
                    {detectedTag && showStreamingTools && (
                        <ShowToolStream
                            content={textToRender.substring(tagStartIndex)}
                            messageId={messageId || 'streamingTextContent'}
                            onToolClick={handleToolClick}
                            showExpanded={true}
                            startTime={Date.now()}
                        />
                    )}
                </>
            );
        },
        [assistantMarkdownClassName, debugMode, handleToolClick, showStreamingTools],
    );

    // Helper function to get agent info robustly
    const getAgentInfo = useCallback(() => {
        // Sanitize name to remove leading emoji/symbols (e.g., 🌞 Zmind -> Zmind)
        const rawName = (agentData && agentData.name) || agentName || 'Zmind';
        const sanitizedName = (rawName || '').replace(/^[^A-Za-z0-9\u4e00-\u9fa5]+/, '').trim() || rawName;
        const isDefault = String(sanitizedName || '').toLowerCase() === 'zmind';

        // Always use product logo as avatar to replace emoji/smile icons.
        return {
            name: sanitizedName,
            isDefault,
            avatar: (
                <div className="h-5 w-5 flex items-center justify-center rounded text-xs">
                    <ZmindLogo size={16} />
                </div>
            )
        };
    }, [agentData, agentName]);
    const agentInfo = getAgentInfo();

    // Simplified scroll handler - flex-column-reverse handles positioning
    const handleScroll = useCallback(() => {
        // No scroll logic needed with flex-column-reverse
    }, []);

    // No scroll-to-bottom needed with flex-column-reverse

    // No auto-scroll needed with flex-column-reverse - CSS handles it

    // Preload all message attachments when messages change or sandboxId is provided
    React.useEffect(() => {
        if (!sandboxId) return;

        // Extract all file attachments from messages
        const allAttachments: string[] = [];

        displayMessages.forEach(message => {
            if (message.type === 'user') {
                try {
                    const content = typeof message.content === 'string' ? message.content : '';
                    const meta = safeJsonParse<ParsedMetadata>(message.metadata, {});
                    const metaAttachments = normalizeMetadataAttachments(meta);
                    const legacyAttachments = extractLegacyAttachmentsFromContent(content);
                    const combined = mergeAttachments(metaAttachments, legacyAttachments);
                    combined.forEach((att) => {
                        const path = typeof att === 'string' ? att : att.path;
                        if (typeof path === 'string' && path.startsWith('/workspace')) {
                            allAttachments.push(path);
                        }
                    });
                } catch (e) {
                    console.error('Error parsing message attachments:', e);
                }
            }
        });

        // Use React Query preloading if we have attachments AND a valid token
        if (allAttachments.length > 0 && session?.access_token) {
            // Preload files with React Query in background
            preloadFiles(sandboxId, allAttachments).catch(err => {
                console.error('React Query preload failed:', err);
            });
        }
    }, [displayMessages, sandboxId, session?.access_token, preloadFiles]);

    return (
        <>
            {displayMessages.length === 0 && !hasStreamingAssistant && !streamingToolCall &&
                !streamingText && !currentToolCall && agentStatus === 'idle' ? (
                // Render empty state outside scrollable container
                <div className="flex-1 min-h-[60vh] flex items-center justify-center">
                    {emptyStateComponent || (
                        <div className="text-center text-muted-foreground">
                            {readOnly ? "No messages to display." : "Send a message to start."}
                        </div>
                    )}
                </div>
            ) : (
                // Render scrollable content container with column-reverse (or just content when external scrolling)
                <div
                    ref={messagesContainerRef}
                    className="py-4 pb-0 overflow-auto"
                >
                    <div ref={contentRef} className="mx-auto max-w-3xl min-w-0 w-full px-3 sm:px-6">
                        <SelectionMarkerOverlay containerRef={contentRef} />
                        <SelectionAddToCanvasButton containerRef={contentRef} disabled={readOnly} />
                        <div className="relative z-10 space-y-6 min-w-0">
                            {(() => {

                                type MessageGroup = {
                                    type: 'user' | 'assistant_group';
                                    messages: UnifiedMessage[];
                                    key: string;
                                };
                                const groupedMessages: MessageGroup[] = [];
                                let currentGroup: MessageGroup | null = null;
                                let assistantGroupCounter = 0; // Counter for assistant groups

                                displayMessages.forEach((message, index) => {
                                    const messageType = message.type;
                                    const key = message.message_id || `msg-${index}`;

                                    if (messageType === 'user') {
                                        // Finalize any existing assistant group
                                        if (currentGroup) {
                                            groupedMessages.push(currentGroup);
                                            currentGroup = null;
                                        }
                                        // Create a new user message group
                                        groupedMessages.push({ type: 'user', messages: [message], key });
                                    } else if (messageType === 'assistant' || messageType === 'tool' || messageType === 'browser_state') {
                                        // Check if we can add to existing assistant group (same agent)
                                        const canAddToExistingGroup = currentGroup &&
                                            currentGroup.type === 'assistant_group' &&
                                            (() => {
                                                // For assistant messages, check if agent matches
                                                if (messageType === 'assistant') {
                                                    const lastAssistantMsg = currentGroup.messages.findLast(m => m.type === 'assistant');
                                                    if (!lastAssistantMsg) return true; // No assistant message yet, can add

                                                    // Compare agent info - both null/undefined should be treated as same (default agent)
                                                    const currentAgentId = message.agent_id;
                                                    const lastAgentId = lastAssistantMsg.agent_id;
                                                    return currentAgentId === lastAgentId;
                                                }
                                                // For tool/browser_state messages, always add to current group
                                                return true;
                                            })();

                                        if (canAddToExistingGroup) {
                                            // Add to existing assistant group
                                            currentGroup?.messages.push(message);
                                        } else {
                                            // Finalize any existing group
                                            if (currentGroup) {
                                                groupedMessages.push(currentGroup);
                                            }
                                            // Create a new assistant group with a group-level key
                                            assistantGroupCounter++;
                                            currentGroup = {
                                                type: 'assistant_group',
                                                messages: [message],
                                                key: `assistant-group-${assistantGroupCounter}`
                                            };
                                        }
                                    } else if (messageType !== 'status') {
                                        // For any other message types, finalize current group
                                        if (currentGroup) {
                                            groupedMessages.push(currentGroup);
                                            currentGroup = null;
                                        }
                                    }
                                });

                                // Finalize any remaining group
                                if (currentGroup) {
                                    groupedMessages.push(currentGroup);
                                }

                                // Merge consecutive assistant groups
                                const mergedGroups: MessageGroup[] = [];
                                let currentMergedGroup: MessageGroup | null = null;

                                groupedMessages.forEach((group) => {
                                    if (group.type === 'assistant_group') {
                                        if (currentMergedGroup && currentMergedGroup.type === 'assistant_group') {
                                            // Merge with the current group
                                            currentMergedGroup.messages.push(...group.messages);
                                        } else {
                                            // Finalize previous group if it exists
                                            if (currentMergedGroup) {
                                                mergedGroups.push(currentMergedGroup);
                                            }
                                            // Start new merged group
                                            currentMergedGroup = { ...group };
                                        }
                                    } else {
                                        // Finalize current merged group if it exists
                                        if (currentMergedGroup) {
                                            mergedGroups.push(currentMergedGroup);
                                            currentMergedGroup = null;
                                        }
                                        // Add non-assistant group as-is
                                        mergedGroups.push(group);
                                    }
                                });

                                // Finalize any remaining merged group
                                if (currentMergedGroup) {
                                    mergedGroups.push(currentMergedGroup);
                                }

                                // Use merged groups instead of original grouped messages
                                const finalGroupedMessages = mergedGroups;

                                const streamingReasoningText = streamingReasoningContent || '';
                                const hasStreamingReasoning = streamingReasoningText.length > 0;
                                const lastGroup = finalGroupedMessages.at(-1);

                                // If reasoning starts before any assistant messages, create a placeholder group
                                if (!readOnly && hasStreamingReasoning && (!lastGroup || lastGroup.type !== 'assistant_group')) {
                                    finalGroupedMessages.push({
                                        type: 'assistant_group',
                                        messages: [],
                                        key: 'assistant-group-reasoning-placeholder',
                                    });
                                }

                                
                                // Helper function to add playback streaming content to groups
                                const appendStreamingContent = (content: string) => {
                                    const messageId = 'playbackStreamingText';
                                    const metadata = 'playbackStreamingText';
                                    const keySuffix = 'playback-streaming';
                                    
                                    const lastGroup = finalGroupedMessages.at(-1);
                                    if (!lastGroup || lastGroup.type === 'user') {
                                        assistantGroupCounter++;
                                        finalGroupedMessages.push({
                                            type: 'assistant_group',
                                            messages: [{
                                                content,
                                                type: 'assistant',
                                                message_id: messageId,
                                                metadata,
                                                created_at: new Date().toISOString(),
                                                updated_at: new Date().toISOString(),
                                                is_llm_message: true,
                                                thread_id: messageId,
                                                sequence: Infinity,
                                            }],
                                            key: `assistant-group-${assistantGroupCounter}-${keySuffix}`
                                        });
                                    } else if (lastGroup.type === 'assistant_group') {
                                        const lastMessage = lastGroup.messages[lastGroup.messages.length - 1];
                                        if (lastMessage.message_id !== messageId) {
                                            lastGroup.messages.push({
                                                content,
                                                type: 'assistant',
                                                message_id: messageId,
                                                metadata,
                                                created_at: new Date().toISOString(),
                                                updated_at: new Date().toISOString(),
                                                is_llm_message: true,
                                                thread_id: messageId,
                                                sequence: Infinity,
                                            });
                                        }
                                    }
                                };

                                // Handle playback mode streaming text
                                if (readOnly && streamingText && isStreamingText) {
                                    appendStreamingContent(streamingText);
                                }

                                return finalGroupedMessages.map((group, groupIndex) => {
                                    if (group.type === 'user') {
                                        const message = group.messages[0];
                                        const messageContent = (() => {
                                            try {
                                                const parsed = safeJsonParse<ParsedContent>(message.content, { content: message.content });
                                                const content = parsed.content || message.content;
                                                // Ensure we always return a string
                                                return typeof content === 'string' ? content : String(content || '');
                                            } catch {
                                                // Ensure message.content is a string
                                                return typeof message.content === 'string' ? message.content : String(message.content || '');
                                            }
                                        })();

                                        // In debug mode, display raw message content
                                        if (debugMode) {
                                            const rawDebugContent =
                                                typeof message.content === 'string'
                                                    ? message.content
                                                    : String(message.content || '');
                                            return (
                                                <div key={group.key} className="flex justify-end">
                                                    <div className="flex max-w-[90%] rounded-3xl rounded-br-lg bg-card border border-border/70 px-4 py-3 break-words overflow-hidden">
                                                        <CollapsibleUserMessage locale={locale} contentKey={rawDebugContent}>
                                                            <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto min-w-0 flex-1">
                                                                {rawDebugContent}
                                                            </pre>
                                                        </CollapsibleUserMessage>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const meta = safeJsonParse<ParsedMetadata>(message.metadata, {});
                                        const metaAttachments = normalizeMetadataAttachments(meta);
                                        const legacyAttachments = extractLegacyAttachmentsFromContent(messageContent);
                                        const attachments = mergeAttachments(metaAttachments, legacyAttachments);

                                        // Remove attachment info from the message content
                                        const cleanContent = messageContent.replace(/\[Uploaded File: .*?\]/g, '').trim();

                                        return (
                                            <div key={group.key} className="space-y-3">
                                                {/* All file attachments rendered outside message bubble */}
                                                {renderStandaloneAttachments(attachments, handleOpenFileViewer, sandboxId, project, true, shareThreadId)}
                                                
                                                {cleanContent && (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <div className="flex justify-end w-full">
                                                        <div className="flex max-w-[90%] rounded-3xl rounded-br-lg bg-card border border-border/70 px-4 py-3 break-words overflow-hidden">
                                                                <div className="space-y-3 min-w-0 flex-1">
                                                                    <CollapsibleUserMessage locale={locale} contentKey={cleanContent}>
                                                                        <ComposioUrlDetector
                                                                            content={cleanContent}
                                                                            className={STREAMING_MARKDOWN_CLASSNAME}
                                                                        />
                                                                    </CollapsibleUserMessage>
                                                                    {/* Keep inner-bubble attachments hidden to avoid duplication */}
                                                                    {renderAttachments(attachments, handleOpenFileViewer, sandboxId, project)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            title="复制"
                                                            aria-label="复制"
                                                            onClick={() => {
                                                                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                                                                    navigator.clipboard
                                                                        .writeText(cleanContent)
                                                                        .then(() => toast.success('已复制'))
                                                                        .catch(() => toast.error('复制失败'));
                                                                }
                                                            }}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    } else if (group.type === 'assistant_group') {
                                        // Get agent_id from the first assistant message in this group
                                        const firstAssistantMsg = group.messages.find(m => m.type === 'assistant');
                                        const groupAgentId = firstAssistantMsg?.agent_id;
                                        const isLastGroup = groupIndex === finalGroupedMessages.length - 1;
                                        let runElapsedMs: number | null = null;
                                        let runStatus: string | undefined = undefined;
                                        if (showResponseTime) {
                                            const lastAssistant = [...group.messages].reverse().find(m => m.type === 'assistant');
                                            if (lastAssistant) {
                                                const meta = safeJsonParse<ParsedMetadata>(lastAssistant.metadata, {});
                                                const rawElapsed = meta?.run_elapsed_ms;
                                                if (typeof rawElapsed === 'number') {
                                                    runElapsedMs = rawElapsed;
                                                } else if (typeof rawElapsed === 'string') {
                                                    const parsed = Number.parseInt(rawElapsed, 10);
                                                    runElapsedMs = Number.isFinite(parsed) ? parsed : null;
                                                }
                                                if (typeof meta?.run_status === 'string') {
                                                    runStatus = meta.run_status;
                                                }
                                            }
                                        }
                                        const shouldShowWorkingLabel =
                                            showResponseTime && !runElapsedMs && isAgentActive && isLastGroup && runStartedAt;
                                        
                                        return (
                                            <div key={group.key} ref={groupIndex === groupedMessages.length - 1 ? latestMessageRef : null}>
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex items-center">
                                                        {(() => {
                                                            const runtimeLabel = showResponseTime && runElapsedMs ? (
                                                                <RunTimeLabel locale={locale} mode="done" elapsedMs={runElapsedMs} status={runStatus} />
                                                            ) : shouldShowWorkingLabel ? (
                                                                <RunTimeLabel locale={locale} mode="working" startedAt={runStartedAt} />
                                                            ) : null;

                                                            if (groupAgentId) {
                                                                return (
                                                                    <>
                                                                        <div className="rounded-md flex items-center justify-center relative">
                                                                            <AgentAvatar agentId={groupAgentId} size={20} className="h-5 w-5" />
                                                                        </div>
                                                                        <p className="ml-2 text-sm text-muted-foreground">
                                                                            <AgentName agentId={groupAgentId} fallback={agentInfo.name} />
                                                                            {runtimeLabel}
                                                                        </p>
                                                                    </>
                                                                );
                                                            }

                                                            if (agentInfo.isDefault) {
                                                                return (
                                                                    <>
                                                                        <ZmindWordmark />
                                                                        {runtimeLabel}
                                                                    </>
                                                                );
                                                            }

                                                            return (
                                                                <>
                                                                    <div className="rounded-md flex items-center justify-center relative">
                                                                        {agentInfo.avatar}
                                                                    </div>
                                                                    <p className="ml-2 text-sm text-muted-foreground">
                                                                        {agentInfo.name}
                                                                        {runtimeLabel}
                                                                    </p>
                                                                </>
                                                            );
                                                        })()}
                                                    </div>

                                                    {/* Message content - ALL messages in the group */}
                                                    <div className="flex w-full break-words overflow-hidden">
                                                        <div className="relative space-y-2 min-w-0 flex-1">
                                                            {(() => {
                                                                // In debug mode, just show raw messages content
                                                                if (debugMode) {
                                                                    return group.messages.map((message, msgIndex) => {
                                                                        const msgKey = message.message_id || `raw-msg-${msgIndex}`;
                                                                        return (
                                                                            <div key={msgKey} className="mb-4">
                                                                                <div className="text-xs font-medium text-muted-foreground mb-1">
                                                                                    Type: {message.type} | ID: {message.message_id || 'no-id'}
                                                                                </div>
                                                                                <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                                                                                    {JSON.stringify(message.content, null, 2)}
                                                                                </pre>
                                                                                {message.metadata && message.metadata !== '{}' && (
                                                                                    <div className="mt-2">
                                                                                        <div className="text-xs font-medium text-muted-foreground mb-1">
                                                                                            Metadata:
                                                                                        </div>
                                                                                        <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                                                                                            {JSON.stringify(message.metadata, null, 2)}
                                                                                        </pre>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    });
                                                                }

                                                                const toolResultsMap = new Map<string | null, UnifiedMessage[]>();
                                                                group.messages.forEach(msg => {
                                                                    if (msg.type === 'tool') {
                                                                        const meta = safeJsonParse<ParsedMetadata>(msg.metadata, {});
                                                                        const assistantId = meta.assistant_message_id || null;
                                                                        if (!toolResultsMap.has(assistantId)) {
                                                                            toolResultsMap.set(assistantId, []);
                                                                        }
                                                                        toolResultsMap.get(assistantId)?.push(msg);
                                                                    }
                                                                });

                                                                const elements: React.ReactNode[] = [];
                                                                let assistantMessageCount = 0; // Move this outside the loop
                                                                let groupCopyableText = '';
                                                                const groupCtas: CtaAction[] = [];
                                                                const ctaKeys = new Set<string>();

                                                                const pushCtas = (items: CtaAction[]) => {
                                                                    items.forEach((cta) => {
                                                                        // Filter out research_plan.* CTAs — handled by ResearchPlanCard
                                                                        if (cta.action && cta.action.startsWith('research_plan.')) return;
                                                                        let payloadKey = '';
                                                                        if (cta.payload !== undefined) {
                                                                            try {
                                                                                payloadKey = JSON.stringify(cta.payload);
                                                                            } catch {
                                                                                payloadKey = String(cta.payload);
                                                                            }
                                                                        }
                                                                        const key = `${cta.label}::${cta.action}::${payloadKey}`;
                                                                        if (ctaKeys.has(key)) return;
                                                                        ctaKeys.add(key);
                                                                        groupCtas.push(cta);
                                                                    });
                                                                };

                                                                // Helper: copy text utility for assistant messages
                                                                const copyAssistantText = (text: string) => {
                                                                    const value = text ?? '';
                                                                    if (!value) {
                                                                        toast.info('没有可复制的内容');
                                                                        return;
                                                                    }
                                                                    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                                                                        navigator.clipboard
                                                                            .writeText(value)
                                                                            .then(() => toast.success('已复制'))
                                                                            .catch(() => toast.error('复制失败'));
                                                                    }
                                                                };
                                                                const copyAssistantMetadata = (messagesToCopy: UnifiedMessage[]) => {
                                                                    const extractToolCallId = (msg: UnifiedMessage, meta: any) => {
                                                                        const contentObj = safeJsonParse<any>(msg.content, {});
                                                                        const direct =
                                                                            contentObj?.tool_call_id ||
                                                                            contentObj?.toolCallId ||
                                                                            contentObj?.tool_call ||
                                                                            contentObj?.toolCall;
                                                                        if (direct) return String(direct);
                                                                        const toolExec = meta?.frontend_content?.tool_execution;
                                                                        const execId = toolExec?.tool_call_id || toolExec?.toolCallId;
                                                                        return execId ? String(execId) : null;
                                                                    };
                                                                    const extractParentToolCallId = (meta: any) => {
                                                                        const parent =
                                                                            meta?.parent_tool_call_id ||
                                                                            meta?.parentToolCallId ||
                                                                            meta?.parent_tool_call ||
                                                                            meta?.parentToolCall;
                                                                        return parent ? String(parent) : null;
                                                                    };

                                                                    const parentToolCallIds = new Set<string>();
                                                                    messagesToCopy.forEach((msg) => {
                                                                        if (msg.type !== 'tool') return;
                                                                        const meta = safeJsonParse<any>(msg.metadata, {});
                                                                        const toolCallId = extractToolCallId(msg, meta);
                                                                        if (toolCallId) parentToolCallIds.add(toolCallId);
                                                                    });

                                                                    const extraMessages =
                                                                        parentToolCallIds.size > 0
                                                                            ? displayMessages.filter((msg) => {
                                                                                  if (msg.type !== 'tool') return false;
                                                                                  const meta = safeJsonParse<any>(msg.metadata, {});
                                                                                  const parentId = extractParentToolCallId(meta);
                                                                                  return parentId ? parentToolCallIds.has(parentId) : false;
                                                                              })
                                                                            : [];

                                                                    const combined = [...messagesToCopy, ...extraMessages];
                                                                    const seen = new Set<string>();
                                                                    const deduped = combined.filter((msg, idx) => {
                                                                        const key = msg.message_id || `${msg.type}-${msg.created_at}-${idx}`;
                                                                        if (seen.has(key)) return false;
                                                                        seen.add(key);
                                                                        return true;
                                                                    });

                                                                    deduped.sort((a, b) => {
                                                                        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
                                                                        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                                                                        return aTime - bTime;
                                                                    });

                                                                    const payload = deduped.map((msg) => ({
                                                                        message_id: msg.message_id,
                                                                        type: msg.type,
                                                                        agent_id: msg.agent_id || null,
                                                                        created_at: msg.created_at,
                                                                        metadata_raw: msg.metadata,
                                                                        metadata: safeJsonParse<any>(msg.metadata, msg.metadata),
                                                                    }));
                                                                    const serialized = JSON.stringify(payload, null, 2);
                                                                    copyAssistantText(serialized);
                                                                };

                                                                // Collapsible reasoning panel per assistant group (default collapsed)
                                                                // Determine this group's thread_run_id from any assistant/tool message in the group
                                                                const groupRunId: string | null = (() => {
                                                                    for (const gm of group.messages) {
                                                                        try {
                                                                            const md = safeJsonParse<ParsedMetadata>(gm.metadata as any, {});
                                                                            if (md && (md as any).thread_run_id) return String((md as any).thread_run_id);
                                                                        } catch {}
                                                                    }
                                                                    return null;
                                                                })();

                                                                // Gather persisted reasoning for this group by run_id
                                                                const persistedReasoningText: string = (() => {
                                                                    if (!groupRunId) return '';
                                                                    let txt = '';
                                                                    for (const m of messages) {
                                                                        if (m.type !== 'status') continue;
                                                                        try {
                                                                            const md = safeJsonParse<ParsedMetadata>(m.metadata as any, {});
                                                                            if (!md || (md as any).thread_run_id !== groupRunId) continue;
                                                                            const pc = safeJsonParse<ParsedContent>(m.content as any, {});
                                                                            if (pc && pc.status_type === 'reasoning' && typeof pc.content === 'string') {
                                                                                txt += pc.content;
                                                                            }
                                                                        } catch {}
                                                                    }
                                                                    return txt;
                                                                })();

                                                                // Choose text source: if last group and streaming available, use streaming; otherwise use persisted
                                                                const isLastGroup = groupIndex === finalGroupedMessages.length - 1;
                                                                const panelText = (isLastGroup && hasStreamingReasoning)
                                                                    ? streamingReasoningText
                                                                    : persistedReasoningText;

                                                                if ((panelText || '').length > 0) {
                                                                    elements.push(
                                                                        <div key={`reasoning-panel-${groupIndex}`} className="mb-2">
                                                                            <details className="group border border-border/50 rounded-md bg-muted/40">
                                                                                <summary className="cursor-pointer select-none list-none p-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-2">
                                                                                    <span className="inline-flex h-2 w-2 rounded-full bg-amber-500/80"></span>
                                                                                    <span>思考过程（Reasoning）</span>
                                                                                    <span className="ml-auto text-[10px] opacity-70">点击展开/折叠</span>
                                                                                </summary>
                                                                                <div className="px-3 pb-2">
                                                                                    <div className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground/90">
                                                                                        {panelText}
                                                                                    </div>
                                                                                    {(!isLiveStreaming || allowCopyWhileStreaming) && (
                                                                                        <div className="mt-1">
                                                                                            <button
                                                                                                type="button"
                                                                                                title="复制思考过程"
                                                                                                aria-label="复制思考过程"
                                                                                                onClick={() => copyAssistantText(panelText)}
                                                                                                className="inline-flex items-center justify-center px-1.5 py-1 rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                                                                                            >
                                                                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path></svg>
                                                                                            </button>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </details>
                                                                        </div>
                                                                    );
                                                                }

                                                               const childToolsByParent = new Map<
                                                                    string,
                                                                    {
                                                                        exec: ToolExecution;
                                                                        messageId: string | null;
                                                                        subagent?: string;
                                                                        subagentDisplay?: string;
                                                                    }[]
                                                                >();
                                                                const parentToolCallIds = new Set<string>();
                                                                let latestResearchPublication: ResearchPublicationPayload | null = null;
                                                                let latestResearchVerification: ResearchVerificationPayload | undefined;
                                                                let latestResearchPlan: ResearchPlanPayload | null = null;

                                                                const formatDisplayName = (value?: string | null) => {
                                                                    if (!value || typeof value !== 'string') return null;
                                                                    const trimmed = value.trim();
                                                                    if (!trimmed) return null;
                                                                    return trimmed
                                                                        .replace(/[\-_]/g, ' ')
                                                                        .split(' ')
                                                                        .filter(Boolean)
                                                                        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                                                                        .join(' ');
                                                                };

                                                                const deriveDisplayName = (exec: ToolExecution, meta?: ParsedMetadata) => {
                                                                    const direct = formatDisplayName(exec.display_name);
                                                                    if (direct) return direct;
                                                                    const metaDisplay = formatDisplayName((meta as any)?.subagent_display_name);
                                                                    if (metaDisplay) return metaDisplay;
                                                                    const out = exec.result?.output;
                                                                    if (out && typeof out === 'object' && !Array.isArray(out)) {
                                                                        const outputDisplay = formatDisplayName((out as any).display_name);
                                                                        if (outputDisplay) return outputDisplay;
                                                                        const agent = (out as any).agent;
                                                                        const fromResult = formatDisplayName(agent);
                                                                        if (fromResult) return fromResult;
                                                                    }
                                                                    const fromArgs = formatDisplayName(exec.arguments?.agent);
                                                                    if (fromArgs) return fromArgs;
                                                                    return null;
                                                                };

                                                                const extractToolExec = (message: UnifiedMessage) => {
                                                                    const meta = safeJsonParse<ParsedMetadata>(message.metadata, {});
                                                                    const contentObj: any =
                                                                        typeof message.content === 'string'
                                                                            ? safeJsonParse<any>(message.content, {})
                                                                            : (message.content as any);
                                                                    const toolExec =
                                                                        (contentObj && contentObj.tool_execution) ||
                                                                        (meta && (meta as any).frontend_content && (meta as any).frontend_content.tool_execution);
                                                                    const toolCallId =
                                                                        toolExec?.tool_call_id ||
                                                                        contentObj?.tool_call_id ||
                                                                        (meta as any)?.tool_call_id ||
                                                                        (meta as any)?.toolCallId;
                                                                    const parentToolCallId =
                                                                        (meta as any)?.parent_tool_call_id ||
                                                                        (meta as any)?.parentToolCallId;
                                                                    const subagent = (meta as any)?.subagent;
                                                                    const subagentDisplay = (meta as any)?.subagent_display_name;
                                                                    return { meta, toolExec, toolCallId, parentToolCallId, subagent, subagentDisplay };
                                                                };

                                                               const decorateToolExec = (toolExec: any, meta?: ParsedMetadata) => {
                                                                    const exec = { ...toolExec } as ToolExecution;
                                                                    const displayName = deriveDisplayName(exec, meta);
                                                                    if (displayName) {
                                                                        exec.display_name = displayName;
                                                                    }
                                                                    return exec;
                                                                };

                                                                group.messages.forEach((message) => {
                                                                    if (message.type !== 'tool') return;
                                                                    try {
                                                                        const metaSnapshot = safeJsonParse<ParsedMetadata>(message.metadata, {});
                                                                        const toolCtas = normalizeCtaButtons((metaSnapshot as any)?.frontend_content?.cta);
                                                                        if (toolCtas.length) {
                                                                            pushCtas(toolCtas);
                                                                        }
                                                                        const { meta, toolExec, toolCallId, parentToolCallId, subagent, subagentDisplay } =
                                                                            extractToolExec(message);
                                                                        const decoratedExec = toolExec ? decorateToolExec(toolExec, meta) : null;
                                                                        if (decoratedExec) {
                                                                            const researchSnapshot = extractResearchPublicationSnapshot(decoratedExec);
                                                                            if (researchSnapshot) {
                                                                                latestResearchPublication = researchSnapshot.publication;
                                                                                latestResearchVerification = researchSnapshot.verification;
                                                                                // Full research completed — clear any stale plan
                                                                                latestResearchPlan = null;
                                                                            }
                                                                            const planSnapshot = extractResearchPlanSnapshot(decoratedExec);
                                                                            if (planSnapshot) {
                                                                                latestResearchPlan = planSnapshot;
                                                                            }
                                                                        }
                                                                        if (parentToolCallId && decoratedExec) {
                                                                            const entry = {
                                                                                exec: decoratedExec,
                                                                                messageId: message.message_id || null,
                                                                                subagent: typeof subagent === 'string' ? subagent : undefined,
                                                                                subagentDisplay: typeof subagentDisplay === 'string' ? subagentDisplay : undefined,
                                                                            };
                                                                            const list = childToolsByParent.get(String(parentToolCallId)) || [];
                                                                            list.push(entry);
                                                                            childToolsByParent.set(String(parentToolCallId), list);
                                                                            return;
                                                                        }
                                                                        if (toolCallId) {
                                                                            parentToolCallIds.add(String(toolCallId));
                                                                        }
                                                                    } catch {
                                                                        return;
                                                                    }
                                                                });

                                                                type ToolEntry = {
                                                                    exec: ToolExecution;
                                                                    messageId: string | null;
                                                                    toolCallId?: string | null;
                                                                    childTools?: ToolEntry[];
                                                                };

                                                                const buildToolEntry = (message: UnifiedMessage, msgIndex: number): ToolEntry | null => {
                                                                    const { meta, toolExec, toolCallId, parentToolCallId } = extractToolExec(message);
                                                                    if (parentToolCallId) return null;
                                                                    if (!toolExec || !(toolExec.function_name || toolExec.xml_tag_name)) return null;
                                                                    if ((toolExec.function_name || toolExec.xml_tag_name) === 'cta') return null;
                                                                    const exec = decorateToolExec(toolExec, meta);
                                                                    const entry: ToolEntry = {
                                                                        exec,
                                                                        messageId: message.message_id || `tool-${msgIndex}`,
                                                                        toolCallId: toolCallId ? String(toolCallId) : null,
                                                                    };
                                                                    if (toolCallId && childToolsByParent.has(String(toolCallId))) {
                                                                        const children = childToolsByParent.get(String(toolCallId)) || [];
                                                                        entry.childTools = children.map((child) => ({
                                                                            exec: child.exec,
                                                                            messageId: child.messageId || null,
                                                                        }));
                                                                    }
                                                                    return entry;
                                                                };

                                                                const buildGroupKey = (summary: ReturnType<typeof summarize>, exec: ToolExecution) => {
                                                                    const status = exec.result?.success === false ? 'error' : 'ok';
                                                                    return `${summary.label}::${summary.line || ''}::${status}`;
                                                                };

                                                                const groupToolEntries = (entries: ToolEntry[]) => {
                                                                    const groups: { key: string; entries: ToolEntry[]; summary: ReturnType<typeof summarize> }[] = [];
                                                                    entries.forEach((entry) => {
                                                                        const summary = summarize(entry.exec);
                                                                        const key = buildGroupKey(summary, entry.exec);
                                                                        const last = groups[groups.length - 1];
                                                                        const canMerge =
                                                                            !entry.childTools?.length &&
                                                                            last &&
                                                                            !last.entries[0]?.childTools?.length &&
                                                                            last.key === key;
                                                                        if (canMerge) {
                                                                            last.entries.push(entry);
                                                                            return;
                                                                        }
                                                                        groups.push({ key, entries: [entry], summary });
                                                                    });
                                                                    return groups;
                                                                };

                                                                function renderToolEntry(entry: ToolEntry, key: string): React.ReactNode {
                                                                    const childTools = entry.childTools || [];
                                                                    return (
                                                                        <ToolCallInline key={key} exec={entry.exec} insetRightPx={16}>
                                                                            {childTools.length > 0 && (
                                                                                <div className="space-y-2 border-l border-border/50 pl-3">
                                                                                    {renderToolGroups(childTools, `${key}-child`)}
                                                                                </div>
                                                                            )}
                                                                        </ToolCallInline>
                                                                    );
                                                                }

                                                                function renderToolGroups(entries: ToolEntry[], keyPrefix: string): React.ReactNode[] {
                                                                    const grouped = groupToolEntries(entries);
                                                                    return grouped.map((group, groupIndex) => {
                                                                        const groupKey = `${keyPrefix}-${groupIndex}-${group.key}`;
                                                                        if (group.entries.length === 1) {
                                                                            return renderToolEntry(group.entries[0], groupKey);
                                                                        }
                                                                        const summary = {
                                                                            label: group.summary.label,
                                                                            line: group.summary.line,
                                                                        };
                                                                        return (
                                                                            <ToolCallInline
                                                                                key={groupKey}
                                                                                exec={group.entries[0].exec}
                                                                                insetRightPx={16}
                                                                                summaryOverride={summary}
                                                                                badgeCount={group.entries.length}
                                                                            >
                                                                                <div className="space-y-2 border-l border-border/40 pl-3">
                                                                                    {group.entries.map((entry, entryIndex) =>
                                                                                        renderToolEntry(entry, `${groupKey}-item-${entryIndex}`),
                                                                                    )}
                                                                                </div>
                                                                            </ToolCallInline>
                                                                        );
                                                                    });
                                                                }

                                                                const pendingToolEntries: ToolEntry[] = [];
                                                                let toolBlockIndex = 0;

                                                                const flushToolEntries = () => {
                                                                    if (!pendingToolEntries.length) return;
                                                                    const blockKey = `tool-block-${groupIndex}-${toolBlockIndex}`;
                                                                    toolBlockIndex += 1;
                                                                    elements.push(
                                                                        <div key={blockKey} className={assistantMessageCount > 0 ? 'mt-4' : ''}>
                                                                            <div className="space-y-2">
                                                                                {renderToolGroups(pendingToolEntries, blockKey)}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                    pendingToolEntries.length = 0;
                                                                };

                                                               group.messages.forEach((message, msgIndex) => {
                                                                   if (message.type === 'assistant') {
                                                                       flushToolEntries();
                                                                       const parsedContent = safeJsonParse<ParsedContent>(message.content, {});
                                                                       const parsedMetadata = safeJsonParse<ParsedMetadata>(message.metadata, {});
                                                                       const frontendContent =
                                                                           toObjectRecord((parsedContent as any).frontend_content) ||
                                                                           toObjectRecord((parsedMetadata as any).frontend_content);
                                                                       const canvasPreview =
                                                                           normalizeCanvasPreview((parsedContent as any).canvas_preview) ||
                                                                           normalizeCanvasPreview(frontendContent?.canvas_preview) ||
                                                                           normalizeCanvasPreview(frontendContent?.canvas_preview_ir_v2);
                                                                       const msgKey = message.message_id || `submsg-assistant-${msgIndex}`;
                                                                       const isStreaming = isStreamingMessage(message);

                                                                        if (parsedContent && typeof parsedContent === 'object') {
                                                                            const contentCtas = normalizeCtaButtons(
                                                                                (parsedContent as any).cta ||
                                                                                    frontendContent?.cta ||
                                                                                    (parsedContent as any).actions ||
                                                                                    (parsedContent as any).buttons,
                                                                            );
                                                                            if (contentCtas.length) {
                                                                                pushCtas(contentCtas);
                                                                            }
                                                                        }

                                                                        if (!parsedContent.content) return;

                                                                        const renderedContent =
                                                                            isStreaming && typeof parsedContent.content === 'string'
                                                                                ? renderStreamingAssistantContent(parsedContent.content, message.message_id)
                                                                                : renderContentWithInlineTools(
                                                                                      parsedContent.content,
                                                                                      handleToolClick,
                                                                                      message.message_id,
                                                                                      handleOpenFileViewer,
                                                                                      sandboxId,
                                                                                      project,
                                                                                      debugMode,
                                                                                      shareThreadId,
                                                                                      assistantMarkdownClassName,
                                                                                  );

                                                                        // Build copyable text from parsed content, with text-only tool preprocessing
                                                                        const copyable = (() => {
                                                                            try {
                                                                                const raw = typeof parsedContent.content === 'string' ? parsedContent.content : String(parsedContent.content || '');
                                                                                return preprocessTextOnlyTools(raw);
                                                                            } catch {
                                                                                return typeof parsedContent.content === 'string' ? parsedContent.content : String(parsedContent.content || '');
                                                                            }
                                                                        })();

                                                                        // Accumulate group-level copyable text (do not include streaming placeholder message)
                                                                        if (!isStreaming && copyable) {
                                                                            groupCopyableText += (groupCopyableText ? '\n\n' : '') + copyable;
                                                                        }

                                                                        elements.push(
                                                                            <div key={msgKey} className={assistantMessageCount > 0 ? "mt-4" : ""}>
                                                                                {canvasPreview && (
                                                                                    <CanvasPreviewCard
                                                                                        preview={canvasPreview}
                                                                                        className="mb-3"
                                                                                    />
                                                                                )}
                                                                                <div className="text-base prose dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-hidden">
                                                                                    {renderedContent}
                                                                                </div>
                                                                            </div>
                                                                        );

                                                                        assistantMessageCount++; // Increment after adding the element
                                                                    } else if (message.type === 'tool') {
                                                                        try {
                                                                            const entry = buildToolEntry(message, msgIndex);
                                                                            if (entry) {
                                                                                pendingToolEntries.push(entry);
                                                                            }
                                                                        } catch (e) {
                                                                            console.error('Failed to render tool message inline:', e);
                                                                        }
                                                                    }
                                                                });

                                                                const orphanParents = Array.from(childToolsByParent.entries()).filter(
                                                                    ([parentId]) => !parentToolCallIds.has(parentId),
                                                                );
                                                                if (orphanParents.length > 0) {
                                                                    orphanParents.forEach(([parentId, childTools]) => {
                                                                        if (!childTools.length) return;
                                                                        const subagent = childTools.find((c) => c.subagent)?.subagent;
                                                                        const subagentDisplay = childTools.find((c) => c.subagentDisplay)?.subagentDisplay;
                                                                        const displayName = subagentDisplay || subagent || 'subagent';
                                                                        const placeholderExec: ToolExecution = {
                                                                            function_name: `transfer_to_${subagent || 'subagent'}`,
                                                                            result: { success: true },
                                                                            display_name: displayName,
                                                                        };
                                                                        const orphanEntry: ToolEntry = {
                                                                            exec: placeholderExec,
                                                                            messageId: `subagent-${parentId}`,
                                                                            toolCallId: parentId,
                                                                            childTools: childTools.map((child) => ({
                                                                                exec: child.exec,
                                                                                messageId: child.messageId || null,
                                                                            })),
                                                                        };
                                                                        pendingToolEntries.push(orphanEntry);
                                                                    });
                                                                }

                                                               flushToolEntries();

                                                                if (
                                                                    latestResearchPlan &&
                                                                    latestResearchPlan.status === 'plan_generated' &&
                                                                    Array.isArray(latestResearchPlan.queries) &&
                                                                    latestResearchPlan.queries.length > 0
                                                                ) {
                                                                    elements.push(
                                                                        <div key={`research-plan-${group.key}`} className="mt-3">
                                                                            <ResearchPlanCard
                                                                                plan={latestResearchPlan}
                                                                                onCtaAction={onCtaAction}
                                                                                disabled={readOnly || agentStatus !== 'idle'}
                                                                            />
                                                                        </div>
                                                                    );
                                                                }

                                                                const publicationStatus = String(latestResearchPublication?.status || '').toLowerCase();
                                                                const shouldShowResearchPublicationCard = Boolean(
                                                                    latestResearchPublication &&
                                                                        (publicationStatus === 'published' ||
                                                                            publicationStatus === 'partial' ||
                                                                            publicationStatus === 'failed' ||
                                                                            latestResearchPublication.kb_entry_id ||
                                                                            latestResearchPublication.canvas_group_node_id),
                                                                );
                                                                if (shouldShowResearchPublicationCard && latestResearchPublication) {
                                                                    elements.push(
                                                                        <div key={`research-publication-${group.key}`} className="mt-3">
                                                                            <ResearchPublicationCard
                                                                                publication={latestResearchPublication}
                                                                                verification={latestResearchVerification}
                                                                                onOpenKnowledgeEntry={(entryId) => {
                                                                                    const params = new URLSearchParams();
                                                                                    params.set('entry', entryId);
                                                                                    router.push(`/knowledge?${params.toString()}`);
                                                                                }}
                                                                                onOpenCanvasBoard={(canvasId, focusNodeId) => {
                                                                                    const params = new URLSearchParams();
                                                                                    if (focusNodeId) {
                                                                                        params.set('focusNode', focusNodeId);
                                                                                    }
                                                                                    const query = params.toString();
                                                                                    router.push(`/canvas/${canvasId}${query ? `?${query}` : ''}`);
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    );
                                                                }

                                                                if (groupCtas.length) {
                                                                    elements.push(
                                                                        <CtaButtonGroup
                                                                            key={`cta-${group.key}`}
                                                                            ctas={groupCtas}
                                                                            disabled={readOnly || !onCtaAction}
                                                                            agentStatus={agentStatus}
                                                                            onCtaAction={onCtaAction!}
                                                                            groupKey={group.key}
                                                                        />
                                                                    );
                                                                }

                                                                // After listing all messages, render a single group-level copy button if applicable
                                                                try {
                                                                    const isLastGroup = groupIndex === finalGroupedMessages.length - 1;
                                                                    const showGroupCopyButton = (allowCopyWhileStreaming || !isLastGroup || !isLiveStreaming) && Boolean((groupCopyableText || '').trim());
                                                                        if (showGroupCopyButton) {
                                                                            elements.push(
                                                                                <div key={`assistant-group-copy-${group.key}`} className="mt-1 flex items-center gap-1">
                                                                                    <button
                                                                                        type="button"
                                                                                        title="复制"
                                                                                        aria-label="复制"
                                                                                        onClick={() => copyAssistantText(groupCopyableText)}
                                                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                                                                                    >
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                                                    </button>
                                                                                    {isAdmin && (
                                                                                        <button
                                                                                            type="button"
                                                                                            title="复制元数据"
                                                                                            aria-label="复制元数据"
                                                                                            onClick={() => copyAssistantMetadata(group.messages)}
                                                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                                                                                        >
                                                                                        <FileJson className="h-4 w-4" />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                    }
                                                                } catch {}

                                                                return elements;
                                                            })()}

                                                            {/* For playback mode, show streaming text and tool calls */}
                                                            {readOnly && groupIndex === finalGroupedMessages.length - 1 && isStreamingText && (
                                                                <div className="mt-4">
                                                                    {(() => {
                                                                        // Preprocess content first to remove text-only tool tags
                                                                        const textToRender = preprocessTextOnlyTools(streamingText || '');
                                                                        
                                                                        let detectedTag: string | null = null;
                                                                        let tagStartIndex = -1;
                                                                        if (textToRender) {
                                                                            // First check for new format
                                                                            const functionCallsIndex = textToRender.indexOf('<function_calls>');
                                                                            if (functionCallsIndex !== -1) {
                                                                                detectedTag = 'function_calls';
                                                                                tagStartIndex = functionCallsIndex;
                                                                            } else {
                                                                                // Fall back to old format detection
                                                                                for (const tag of HIDE_STREAMING_XML_TAGS) {
                                                                                    const openingTagPattern = `<${tag}`;
                                                                                    const index = textToRender.indexOf(openingTagPattern);
                                                                                    if (index !== -1) {
                                                                                        detectedTag = tag;
                                                                                        tagStartIndex = index;
                                                                                        break;
                                                                                    }
                                                                                }
                                                                            }
                                                                        }
                                                                        const textBeforeTag = detectedTag ? textToRender.substring(0, tagStartIndex) : textToRender;
                                                                        const showCursor = isStreamingText && !detectedTag;

                                                                        return (
                                                                            <>
                                                                                {/* In debug mode, show raw streaming content */}
                                                                                {debugMode && streamingText ? (
                                                                                    <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                                                                                        {streamingText}
                                                                                        {showCursor && (
                                                                                            <span className="inline-block h-4 w-0.5 bg-primary ml-0.5 -mb-1 animate-pulse duration-1000" />
                                                                                        )}
                                                                                    </pre>
                                                                                ) : (
                                                                                    <>
                                                                                        {renderStreamingWithInlineTools(textBeforeTag, assistantMarkdownClassName)}
                                                                                        {detectedTag && showStreamingTools && (
                                                                                            <ShowToolStream
                                                                                                content={textToRender.substring(tagStartIndex)}
                                                                                                messageId="streamingTextContent"
                                                                                                onToolClick={handleToolClick}
                                                                                                showExpanded={true}
                                                                                                startTime={Date.now()} // Tool just started now
                                                                                            />
                                                                                        )}
                                                                                    </>
                                                                                )}
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                });
                            })()}
                            {showWarmupLoader && (
                                <div ref={latestMessageRef} className="w-full rounded">
                                    <div className="flex flex-col gap-2">
                                        {!(readOnly && currentToolCall) && (
                                            <div className="flex items-center">
                                                {agentInfo.isDefault ? (
                                                    <>
                                                        <ZmindWordmark />
                                                        {showResponseTime && isAgentActive && runStartedAt ? (
                                                            <RunTimeLabel locale={locale} mode="working" startedAt={runStartedAt} />
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="rounded-md flex items-center justify-center">
                                                            {agentInfo.avatar}
                                                        </div>
                                                        <p className="ml-2 text-sm text-muted-foreground">
                                                            {agentInfo.name}
                                                            {showResponseTime && isAgentActive && runStartedAt ? (
                                                                <RunTimeLabel locale={locale} mode="working" startedAt={runStartedAt} />
                                                            ) : null}
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                        {canvasProgressHint && (
                                            <p className="text-xs text-muted-foreground">
                                                {canvasProgressHint}
                                            </p>
                                        )}
                                        <div className="space-y-2 w-full h-12">
                                            <AgentLoader />
                                        </div>
                                    </div>
                                </div>
                            )}
                            {showStreamingDot && (
                                <div ref={latestMessageRef} className="w-full rounded">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center">
                                            <LoadingDot size={12} colorClass="bg-primary/70" />
                                        </div>
                                    </div>
                                </div>
                            )}
                            {readOnly && currentToolCall && (
                                <div ref={latestMessageRef}>
                                    <div className="flex flex-col gap-2">
                                        {/* Logo positioned above the tool call */}
                                        <div className="flex justify-start">
                                            {agentInfo.isDefault ? (
                                                <ZmindWordmark />
                                            ) : (
                                                <>
                                                    <div className="rounded-md flex items-center justify-center">
                                                        {agentInfo.avatar}
                                                    </div>
                                                    <p className='ml-2 text-sm text-muted-foreground'>
                                                        {agentInfo.name}
                                                    </p>
                                                </>
                                            )}
                                        </div>

                                        {/* Tool call content */}
                                        <div className="space-y-2">
                                            <div className="animate-shimmer inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium text-primary bg-primary/10 rounded-md border border-primary/20">
                                                <CircleDashed className="h-3.5 w-3.5 text-primary flex-shrink-0 animate-spin animation-duration-2000" />
                                                <span className="font-mono text-xs text-primary">
                                                    {currentToolCall.name || 'Using Tool'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* For playback mode - Show streaming indicator if no messages yet */}
                            {readOnly && visibleMessages && visibleMessages.length === 0 && isStreamingText && (
                                <div ref={latestMessageRef}>
                                    <div className="flex flex-col gap-2">
                                        {/* Logo positioned above the streaming indicator */}
                                        <div className="flex justify-start">
                                            {agentInfo.isDefault ? (
                                                <ZmindWordmark />
                                            ) : (
                                                <>
                                                    <div className="rounded-md flex items-center justify-center">
                                                        {agentInfo.avatar}
                                                    </div>
                                                    <p className='ml-2 text-sm text-muted-foreground'>
                                                        {agentInfo.name}
                                                    </p>
                                                </>
                                            )}
                                        </div>

                                        {/* Streaming indicator content */}
                                        <div className="max-w-[90%] px-4 py-3 text-sm">
                                            <div className="flex items-center gap-1.5 py-1">
                                                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse duration-1000" />
                                                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse duration-1000 delay-150" />
                                                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse duration-1000 delay-300" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="!h-48" />
                        </div>
                    </div>
                </div>
            )}

            {/* No scroll button needed with flex-column-reverse */}
        </>
    );
};

export default ThreadContent; 
