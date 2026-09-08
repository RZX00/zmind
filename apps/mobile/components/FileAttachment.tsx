import { useImageContent } from '@/hooks/useImageContent';
import { useTheme } from '@/hooks/useThemeColor';
import { FileType, getEstimatedFileSize, getFileType } from '@/utils/file-parser';
import { debugLog, errorLog } from '@/utils/logger';
import { File, FileAudio, FileCode, FileImage, FileText, FileVideo } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getRendererForExtension, hasRenderer } from './file-renderers';

export interface FileAttachmentPressPayload {
    path: string;
    fileId?: string;
    storagePath?: string;
    name?: string;
    mimeType?: string;
    threadId?: string;
}

interface FileAttachmentProps {
    filepath: string;
    sandboxId?: string;
    fileId?: string;
    storagePath?: string;
    displayName?: string;
    fileSizeBytes?: number;
    mimeType?: string;
    threadId?: string;
    onPress?: (payload: FileAttachmentPressPayload) => void;
    showPreview?: boolean;
    layout?: 'inline' | 'grid';
    isUploading?: boolean;
    uploadError?: string;
    uploadedBlob?: Blob; // For optimistic caching
    localUri?: string; // For React Native local file URIs
}

const getFileIcon = (type: FileType) => {
    const iconProps = { size: 20, strokeWidth: 2 };

    switch (type) {
        case 'image': return <FileImage {...iconProps} />;
        case 'video': return <FileVideo {...iconProps} />;
        case 'audio': return <FileAudio {...iconProps} />;
        case 'code': return <FileCode {...iconProps} />;
        case 'text': return <FileText {...iconProps} />;
        default: return <File {...iconProps} />;
    }
};

const getTypeLabel = (type: FileType, extension?: string): string => {
    if (type === 'code' && extension) {
        return extension.toUpperCase();
    }

    const labels: Record<FileType, string> = {
        image: 'Image',
        video: 'Video',
        audio: 'Audio',
        pdf: 'PDF',
        text: 'Text',
        code: 'Code',
        other: 'File'
    };

    return labels[type];
};

const formatFileSize = (bytes?: number): string | null => {
    if (!bytes || !Number.isFinite(bytes)) return null;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FileAttachment: React.FC<FileAttachmentProps> = ({
    filepath,
    sandboxId,
    fileId,
    storagePath,
    displayName,
    fileSizeBytes,
    mimeType,
    threadId,
    onPress,
    showPreview = true,
    layout = 'inline',
    isUploading = false,
    uploadError,
    uploadedBlob,
    localUri
}) => {
    const theme = useTheme();
    const effectivePath = storagePath || filepath;
    const filename = displayName || effectivePath.split('/').pop() || 'file';
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const fileType = getFileType(filename);
    const explicitSize = formatFileSize(fileSizeBytes);
    const fileSize = explicitSize || getEstimatedFileSize(effectivePath, fileType);
    const typeLabel = getTypeLabel(fileType, extension);

    const isImage = fileType === 'image';
    const isGrid = layout === 'grid';
    const hasPreviewRenderer = hasRenderer(extension);
    const isRemoteUrl = /^https?:\/\//i.test(effectivePath);
    const isSandboxPath = Boolean(
        sandboxId && filepath && (filepath.startsWith('/workspace') || filepath.startsWith('workspace/'))
    );
    const mediaPath = !isSandboxPath && !isRemoteUrl ? effectivePath : undefined;
    const attachmentScope = isSandboxPath ? 'sandbox' : isRemoteUrl ? 'remote' : 'media';

    // Debug logging
    debugLog('[FileAttachment] Initialized attachment preview', {
        attachmentScope,
        hasLocalUri: Boolean(localUri),
        hasRenderer: hasPreviewRenderer,
    });

    // Use authenticated image loading for images
    const {
        data: fetchedImageUrl,
        isLoading: imageLoading,
        error: imageError,
        isProcessing
    } = useImageContent(
        isImage && isSandboxPath ? sandboxId : undefined,
        isImage ? (isSandboxPath ? filepath : mediaPath) : undefined,
        uploadedBlob,
        isSandboxPath ? undefined : { threadId }
    );

    const imageUrl = isRemoteUrl ? effectivePath : fetchedImageUrl;

    // For local files, use localUri directly
    const localImageUri = !isSandboxPath && isImage && localUri && !imageUrl ? localUri : null;

    // Log image state
    const imageSource = localImageUri ? 'LOCAL' : imageUrl ? (imageUrl.startsWith('data:') ? 'CACHED' : 'SERVER') : 'NONE';
    debugLog('[FileAttachment] Resolved image source', {
        attachmentScope,
        imageSource,
        imageLoading,
    });

    const handlePress = () => {
        onPress?.({
            path: filepath,
            fileId,
            storagePath: storagePath || mediaPath,
            name: displayName || filename,
            mimeType,
            threadId,
        });
    };

    const containerStyle = [
        styles.container,
        {
            backgroundColor: theme.sidebar,
            borderColor: theme.border,
        },
        isGrid ? styles.gridContainer : styles.inlineContainer
    ];

    // FILE RENDERER PREVIEW LOGIC (HTML, Markdown, etc.)
    if (hasPreviewRenderer && showPreview && isGrid) {
        const RendererComponent = getRendererForExtension(extension);

        if (RendererComponent) {
            debugLog('[FileAttachment] Rendering with preview renderer', {
                attachmentScope,
                extension: extension.toUpperCase(),
            });

            return (
                <View
                    style={{
                        backgroundColor: theme.sidebar,
                        borderColor: theme.border,
                        borderRadius: 12,
                        borderWidth: 1,
                        overflow: 'hidden',
                        width: '100%',
                        aspectRatio: 1.5,
                        maxHeight: 250,
                        minHeight: 150,
                    }}
                >
                    <RendererComponent
                        filepath={filepath}
                        sandboxId={sandboxId}
                        storagePath={storagePath || mediaPath}
                        threadId={threadId}
                        filename={filename}
                        uploadedBlob={uploadedBlob}
                        onExternalOpen={handlePress}
                    />
                </View>
            );
        }
    }

    // IMAGES ALWAYS SHOW AS PREVIEWS
    if (isImage && showPreview) {
        // Dynamic height based on layout with aspect ratio considerations
        const maxHeight = isGrid ? 200 : 54;
        const minHeight = isGrid ? 120 : 54;

        // For local files, use blob URL directly
        if (!isSandboxPath && localImageUri) {
            debugLog('[FileAttachment] Rendering local image', {
                attachmentScope,
                layout: isGrid ? 'grid' : 'inline',
            });

            if (isGrid) {
                return (
                    <View
                        style={{
                            backgroundColor: theme.sidebar,
                            borderColor: theme.border,
                            borderRadius: 12,
                            borderWidth: 1,
                            overflow: 'hidden',
                            width: '100%',
                            aspectRatio: 1.5,
                            maxHeight: 250,
                            minHeight: 150,
                        }}
                    >
                        <TouchableOpacity
                            style={styles.imageGridTouchable}
                            onPress={handlePress}
                            activeOpacity={0.8}
                        >
                            <Image
                                source={{ uri: localImageUri }}
                                style={styles.imageGridPreview}
                                resizeMode="cover"
                                onLoad={() => {
                                    debugLog('[FileAttachment] Local image loaded', {
                                        attachmentScope,
                                        layout: 'grid',
                                    });
                                }}
                                onError={(error) => {
                                    errorLog('[FileAttachment] Local image failed to load', {
                                        attachmentScope,
                                        layout: 'grid',
                                        error: error.nativeEvent.error,
                                    });
                                }}
                            />
                        </TouchableOpacity>
                    </View>
                );
            } else {
                return (
                    <TouchableOpacity
                        style={[
                            styles.container,
                            {
                                backgroundColor: theme.sidebar,
                                borderColor: theme.border,
                            },
                            styles.imageInlineContainer
                        ]}
                        onPress={handlePress}
                        activeOpacity={0.8}
                    >
                        <Image
                            source={{ uri: localImageUri }}
                            style={styles.imageInlinePreview}
                            resizeMode="contain"
                            onLoad={() => {
                                debugLog('[FileAttachment] Local image loaded', {
                                    attachmentScope,
                                    layout: 'inline',
                                });
                            }}
                            onError={(error) => {
                                errorLog('[FileAttachment] Local image failed to load', {
                                    attachmentScope,
                                    layout: 'inline',
                                    error: error.nativeEvent.error,
                                });
                            }}
                        />
                    </TouchableOpacity>
                );
            }
        }

        // Loading state (only for server images AND only if we have no image data at all)
        if (imageLoading && !imageUrl) {
            debugLog('[FileAttachment] Rendering loading state', {
                attachmentScope,
                isProcessing,
            });

            return (
                <TouchableOpacity
                    style={[
                        containerStyle,
                        {
                            height: minHeight,
                            justifyContent: 'center',
                            alignItems: 'center'
                        }
                    ]}
                    onPress={handlePress}
                    activeOpacity={0.8}
                >
                    <ActivityIndicator size="small" color={theme.mutedForeground} />
                    {isProcessing && (
                        <Text style={[styles.metadataText, { color: theme.mutedForeground, marginTop: 4 }]}>
                            Processing...
                        </Text>
                    )}
                </TouchableOpacity>
            );
        }

        // Error state (but not if processing)
        if (imageError && !isProcessing) {
            errorLog('[FileAttachment] Rendering error state', {
                attachmentScope,
                isProcessing,
                error: imageError.message || 'unknown error',
            });

            return (
                <TouchableOpacity
                    style={[containerStyle, { height: minHeight }]}
                    onPress={handlePress}
                    activeOpacity={0.8}
                >
                    <View style={[styles.iconContainer, { backgroundColor: theme.background }]}>
                        {React.cloneElement(getFileIcon(fileType), {
                            color: theme.destructive
                        })}
                    </View>
                    <View style={styles.fileInfo}>
                        <Text style={[styles.filename, { color: theme.foreground }]} numberOfLines={1}>
                            {filename}
                        </Text>
                        <Text style={[styles.errorText, { color: theme.destructive }]}>
                            Failed to load
                        </Text>
                    </View>
                </TouchableOpacity>
            );
        }

        // Success: Show image preview with proper aspect ratio (cached or server data)
        if (imageUrl) {
            debugLog('[FileAttachment] Image data available', {
                attachmentScope,
                sourceType: imageUrl.startsWith('data:') ? 'cached' : 'server',
                imageLoading,
            });
        }

        if (imageUrl && isGrid) {
            debugLog('[FileAttachment] Rendering server image', {
                attachmentScope,
                layout: 'grid',
            });

            return (
                <View
                    style={{
                        backgroundColor: theme.sidebar,
                        borderColor: theme.border,
                        borderRadius: 12,
                        borderWidth: 1,
                        overflow: 'hidden',
                        width: '100%',
                        aspectRatio: 1.5,
                        maxHeight: 250,
                        minHeight: 150,
                    }}
                >
                    <TouchableOpacity
                        style={styles.imageGridTouchable}
                        onPress={handlePress}
                        activeOpacity={0.8}
                    >
                        <Image
                            source={imageUrl ? { uri: imageUrl } : undefined}
                            style={styles.imageGridPreview}
                            resizeMode="cover"
                            onLoad={() => {
                                debugLog('[FileAttachment] Server image loaded', {
                                    attachmentScope,
                                    layout: 'grid',
                                });
                            }}
                            onError={(error) => {
                                errorLog('[FileAttachment] Server image failed to load', {
                                    attachmentScope,
                                    layout: 'grid',
                                    error: error.nativeEvent.error,
                                });
                            }}
                        />
                    </TouchableOpacity>
                </View>
            );
        } else if (imageUrl) {
            debugLog('[FileAttachment] Rendering server image', {
                attachmentScope,
                layout: 'inline',
            });

            return (
                <TouchableOpacity
                    style={[
                        styles.container,
                        {
                            backgroundColor: theme.sidebar,
                            borderColor: theme.border,
                        },
                        styles.imageInlineContainer
                    ]}
                    onPress={handlePress}
                    activeOpacity={0.8}
                >
                    <Image
                        source={imageUrl ? { uri: imageUrl } : undefined}
                        style={styles.imageInlinePreview}
                        resizeMode="contain"
                        onLoad={() => {
                            debugLog('[FileAttachment] Server image loaded', {
                                attachmentScope,
                                layout: 'inline',
                            });
                        }}
                        onError={(error) => {
                            errorLog('[FileAttachment] Server image failed to load', {
                                attachmentScope,
                                layout: 'inline',
                                error: error.nativeEvent.error,
                            });
                        }}
                    />
                </TouchableOpacity>
            );
        }
    }

    // Regular file display (non-images, non-renderer files)
    return (
        <TouchableOpacity
            style={[containerStyle, { opacity: isUploading ? 0.7 : 1 }]}
            onPress={handlePress}
            activeOpacity={0.8}
        >
            <View style={[styles.iconContainer, { backgroundColor: theme.background }]}>
                {isUploading ? (
                    <ActivityIndicator size="small" color={theme.mutedForeground} />
                ) : (
                    React.cloneElement(getFileIcon(fileType), {
                        color: uploadError ? theme.destructive : theme.mutedForeground
                    })
                )}
            </View>

            <View style={styles.fileInfo}>
                <Text
                    style={[styles.filename, { color: uploadError ? theme.destructive : theme.foreground }]}
                    numberOfLines={1}
                >
                    {filename}
                </Text>
                <View style={styles.metadata}>
                    {uploadError ? (
                        <Text style={[styles.metadataText, { color: theme.destructive }]}>
                            Upload failed
                        </Text>
                    ) : isUploading ? (
                        <Text style={[styles.metadataText, { color: theme.mutedForeground }]}>
                        </Text>
                    ) : (
                        <>
                            <Text style={[styles.metadataText, { color: theme.mutedForeground }]}>
                                {typeLabel}
                            </Text>
                            <Text style={[styles.metadataText, { color: theme.mutedForeground }]}>
                                • {fileSize}
                            </Text>
                        </>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        borderWidth: 1,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
    },
    inlineContainer: {
        height: 54,
        minWidth: 170,
        maxWidth: 300,
        paddingRight: 12,
    },
    gridContainer: {
        width: '100%',
        minWidth: 170,
    },
    imageInlineContainer: {
        height: 54,
        width: 54,
        minWidth: 54,
        maxWidth: 54,
        padding: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconContainer: {
        width: 54,
        height: 54,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    fileInfo: {
        flex: 1,
        paddingLeft: 12,
        justifyContent: 'center',
        minWidth: 0,
    },
    filename: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 2,
    },
    metadata: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    metadataText: {
        fontSize: 12,
        marginRight: 4,
    },
    imageInlinePreview: {
        width: 54,
        height: 54,
    },
    imageGridPreview: {
        width: '100%',
        height: '100%',
    },
    imageOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 8,
    },
    imageFilename: {
        fontSize: 12,
        fontWeight: '500',
    },
    loadingText: {
        fontSize: 12,
        marginTop: 4,
    },
    errorText: {
        fontSize: 12,
    },
    imageGridTouchable: {
        flex: 1,
        width: '100%',
        height: '100%',
        position: 'relative',
    },
}); 
