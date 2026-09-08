import { AttachmentGroup } from '@/components/AttachmentGroup';
import { useTheme } from '@/hooks/useThemeColor';
import { useSelectedProject } from '@/stores/ui-store';
import { pickFiles, UploadedFile, uploadFilesToStorage } from '@/utils/file-upload';
import { debugLog, errorLog } from '@/utils/logger';
import { ArrowUp, Mic, Paperclip, Square } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardEvent, Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, {
    Easing,
    Extrapolate,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ChatInputProps {
    onSendMessage: (message: string, files?: UploadedFile[]) => void;
    onAttachPress?: () => void;
    onMicPress?: () => void;
    onCancelStream?: () => void;
    placeholder?: string;
    isAtBottomOfChat?: boolean;
    isGenerating?: boolean;
    isSending?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
    onSendMessage,
    onAttachPress,
    onMicPress,
    onCancelStream,
    placeholder = 'Ask Zmind anything...',
    isAtBottomOfChat = true,
    isGenerating = false,
    isSending = false,
}) => {
    const [message, setMessage] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
    const selectedProject = useSelectedProject();
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    // Get sandboxId from selected project
    const sandboxId = selectedProject?.sandbox?.id;

    const keyboardHeight = useSharedValue(0);

    useEffect(() => {
        const handleKeyboardShow = (event: KeyboardEvent) => {
            keyboardHeight.value = withTiming(event.endCoordinates.height, {
                duration: 250,
                easing: Easing.out(Easing.quad),
            });
        };

        const handleKeyboardHide = () => {
            keyboardHeight.value = withTiming(0, {
                duration: 250,
                easing: Easing.out(Easing.quad),
            });
        };

        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSubscription = Keyboard.addListener(showEvent, handleKeyboardShow);
        const hideSubscription = Keyboard.addListener(hideEvent, handleKeyboardHide);

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    const handleSend = () => {
        const trimmedMessage = message.trim();
        if (!trimmedMessage && attachedFiles.length === 0) return;

        const hasPendingUploads = attachedFiles.some((file) => file.isUploading);
        if (hasPendingUploads) {
            Alert.alert('Files are uploading', 'Please wait for uploads to finish.');
            return;
        }

        const hasUploadErrors = attachedFiles.some((file) => file.uploadError);
        if (hasUploadErrors) {
            Alert.alert('Upload failed', 'Remove failed files and try again.');
            return;
        }

        const readyFiles = attachedFiles.filter((file) => file.fileId);
        if (attachedFiles.length > 0 && readyFiles.length === 0) {
            Alert.alert('Attachments unavailable', 'Please reattach your files.');
            return;
        }

        // Pass the message and files separately to the handler
        onSendMessage(trimmedMessage, readyFiles.length > 0 ? readyFiles : undefined);
        setMessage('');
        setAttachedFiles([]);
    };

    const handleAttachPress = async () => {
        try {
            const result = await pickFiles();

            if (result.cancelled || !result.files?.length) {
                return;
            }

            // Upload to storage - files shown immediately with loading state
            await uploadFilesToStorage(
                result.files,
                (files: UploadedFile[]) => setAttachedFiles(prev => [...prev, ...files]),
                (filePath: string, status: { isUploading?: boolean; uploadError?: string; fileId?: string; storagePath?: string }) => {
                    setAttachedFiles(prev => prev.map(file =>
                        file.path === filePath
                            ? { ...file, ...status }
                            : file
                    ));
                }
            );

            onAttachPress?.();
        } catch (error) {
            errorLog('[ChatInput] File attach error', error);
        }
    };

    const removeFile = (index: number) => {
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const containerStyle = useAnimatedStyle(() => {
        const paddingBottom = interpolate(
            keyboardHeight.value,
            [0, 300],
            [Math.max(insets.bottom, 20), 10],
            Extrapolate.CLAMP
        );

        return {
            paddingBottom,
        };
    });

    const fakeViewStyle = useAnimatedStyle(() => {
        return {
            height: keyboardHeight.value,
        };
    });

    const shouldShowCancel = isSending || isGenerating;

    return (
        <>
            <Animated.View style={[
                styles.container,
                {
                    backgroundColor: theme.sidebar,
                    borderTopLeftRadius: 30,
                    borderTopRightRadius: 30,
                    shadowColor: theme.border,
                    shadowOffset: { width: 0, height: -1 },
                    shadowOpacity: 1,
                    shadowRadius: 0,
                    paddingVertical: attachedFiles.length > 0 ? 0 : 12,
                },
                containerStyle
            ]}>
                <View style={[styles.inputContainer, { backgroundColor: theme.sidebar }]}>
                    {/* File attachments preview */}
                    {attachedFiles.length > 0 && (
                            <AttachmentGroup
                                attachments={attachedFiles}
                                layout="inline"
                                showPreviews={true}
                                maxHeight={100}
                                sandboxId={sandboxId}
                                onFilePress={(payload) => {
                                    // Don't remove on file press in inline mode, let X button handle it
                                    debugLog('[ChatInput] Pending file pressed', {
                                        hasFileId: Boolean(payload.fileId),
                                        hasStoragePath: Boolean(payload.storagePath),
                                        hasThreadId: Boolean(payload.threadId),
                                    });
                                }}
                                onRemove={removeFile}
                            />
                        )}

                    <TextInput
                        style={[styles.textInput, { color: theme.foreground }]}
                        value={message}
                        onChangeText={setMessage}
                        placeholder={placeholder}
                        placeholderTextColor={theme.placeholderText}
                        multiline
                        maxLength={2000}
                        returnKeyType="send"
                        onSubmitEditing={handleSend}
                        blurOnSubmit={false}
                    />

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handleAttachPress}
                        >
                            <Paperclip size={20} strokeWidth={2} color={theme.placeholderText} />
                        </TouchableOpacity>

                        <View style={styles.rightButtons}>
                            <TouchableOpacity style={styles.actionButton} onPress={onMicPress}>
                                <Mic size={20} strokeWidth={2} color={theme.placeholderText} style={{ marginRight: 10 }} />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.sendButton, {
                                    backgroundColor: shouldShowCancel || message.trim() || attachedFiles.length > 0
                                        ? theme.activeButton
                                        : theme.inactiveButton
                                }]}
                                onPress={shouldShowCancel ? onCancelStream : handleSend}
                                disabled={!shouldShowCancel && !message.trim() && attachedFiles.length === 0}
                            >
                                {shouldShowCancel ? (
                                    <Square
                                        size={16}
                                        strokeWidth={2}
                                        color={theme.background}
                                        fill={theme.background}
                                    />
                                ) : (
                                    <ArrowUp
                                        size={19}
                                        strokeWidth={3}
                                        color={message.trim() || attachedFiles.length > 0 ? theme.background : theme.disabledText}
                                    />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Animated.View>
            {/* Fake view that ALWAYS pushes content up */}
            <Animated.View style={fakeViewStyle} />
        </>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 10,
        paddingVertical: 0,
    },
    inputContainer: {
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    textInput: {
        fontSize: 16,
        maxHeight: 100,
        backgroundColor: 'transparent',
        marginBottom: 8,
        ...Platform.select({
            ios: {
                paddingTop: 12,
            },
        }),
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    rightButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    actionButton: {
        width: 22,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButton: {
        width: 36,
        height: 36,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    attachIcon: {
        width: 16,
        height: 16,
        borderRadius: 2,
    },
    micIcon: {
        width: 14,
        height: 14,
        borderRadius: 7,
    },
    sendIcon: {
        width: 0,
        height: 0,
        borderStyle: 'solid',
        borderLeftWidth: 14,
        borderRightWidth: 0,
        borderBottomWidth: 7,
        borderTopWidth: 7,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
    },
}); 
