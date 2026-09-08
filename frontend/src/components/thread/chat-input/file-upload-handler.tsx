'use client';

import React, { forwardRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Paperclip, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UploadedFile } from './chat-input';
import { normalizeFilenameToNFC } from '@/lib/utils/unicode';
import { DEFAULT_MAX_FILE_SIZE_BYTES } from '@/lib/constants/files';
import { uploadFileWithIntent } from '@/lib/api/files';
import {
  KnowledgeBasePickerDialog,
  type KnowledgeBaseAttachmentSource,
} from './knowledge-base-picker';

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const uploadFiles = async (
  files: File[],
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>,
  maxFileBytes: number = DEFAULT_MAX_FILE_SIZE_BYTES,
) => {
  try {
    setIsUploading(true);

    const newUploadedFiles: UploadedFile[] = [];

    for (const file of files) {
      if (file.size > maxFileBytes) {
        toast.error(`File exceeds ${formatBytes(maxFileBytes)} limit: ${file.name}`);
        continue;
      }
      const normalizedName = normalizeFilenameToNFC(file.name);
      const intent = await uploadFileWithIntent(file, 'chat');
      newUploadedFiles.push({
        name: normalizedName,
        fileId: intent.file_id,
        path: intent.storage_key || intent.file_id,
        size: file.size,
        type: file.type || 'application/octet-stream',
        localUrl: URL.createObjectURL(file),
        storagePath: intent.storage_key,
      });
      toast.success(`File uploaded: ${normalizedName}`);
    }

    setUploadedFiles((prev) => [...prev, ...newUploadedFiles]);
  } catch (error) {
    console.error('File upload failed:', error);
    toast.error(
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : 'Failed to upload file',
    );
  } finally {
    setIsUploading(false);
  }
};

const handleFiles = async (
  files: File[],
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>,
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>,
  maxFileBytes: number = DEFAULT_MAX_FILE_SIZE_BYTES,
) => {
  setPendingFiles((prevFiles) => [...prevFiles, ...files]);
  try {
    await uploadFiles(files, setUploadedFiles, setIsUploading, maxFileBytes);
  } finally {
    setPendingFiles((prevFiles) => prevFiles.filter((f) => !files.includes(f)));
  }
};

interface FileUploadHandlerProps {
  loading: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  isUploading: boolean;
  sandboxId?: string;
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>;
  isLoggedIn?: boolean;
  maxFileBytes?: number;
  iconOnly?: boolean;
}

export const FileUploadHandler = forwardRef<
  HTMLInputElement,
  FileUploadHandlerProps
>(
  (
    {
      loading,
      disabled,
      isAgentRunning,
      isUploading,
      setPendingFiles,
      setUploadedFiles,
      setIsUploading,
      isLoggedIn = true,
      maxFileBytes,
      iconOnly = false,
    },
    ref,
  ) => {
    const [isKnowledgePickerOpen, setIsKnowledgePickerOpen] = useState(false);

    // Clean up object URLs when component unmounts
    useEffect(() => {
      return () => {
        // Clean up any object URLs to avoid memory leaks
        setUploadedFiles(prev => {
          prev.forEach(file => {
            if (file.localUrl) {
              URL.revokeObjectURL(file.localUrl);
            }
          });
          return prev;
        });
      };
    }, [setUploadedFiles]);

    const handleFileUpload = () => {
      if (ref && 'current' in ref && ref.current) {
        ref.current.click();
      }
    };

    const processFileUpload = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      if (!event.target.files || event.target.files.length === 0) return;

      const files = Array.from(event.target.files);
      // Use the helper function instead of the static method
      handleFiles(
        files,
        setPendingFiles,
        setUploadedFiles,
        setIsUploading,
        maxFileBytes,
      );

      event.target.value = '';
    };

    const handleAttachKnowledgeFile = (file: KnowledgeBaseAttachmentSource) => {
      if (!file.fileId) {
        toast.error('File is not available');
        return;
      }
      if (maxFileBytes && file.size > maxFileBytes) {
        toast.error(`File exceeds ${formatBytes(maxFileBytes)} limit: ${file.name}`);
        return;
      }
      setUploadedFiles((prev) => {
        const exists = prev.some((item) => item.fileId === file.fileId || item.path === file.fileId);
        if (exists) return prev;
        return [
          ...prev,
          {
            name: file.name,
            fileId: file.fileId,
            path: file.fileId,
            size: file.size || 0,
            type: file.type || 'application/octet-stream',
            storagePath: file.storagePath || undefined,
          },
        ];
      });
      setIsKnowledgePickerOpen(false);
    };

    const isAttachDisabled =
      !isLoggedIn || loading || (disabled && !isAgentRunning) || isUploading;

    return (
      <>
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild disabled={isAttachDisabled}>
                  <span className="inline-block">
                    <Button
                      type="button"
                      variant={iconOnly ? "ghost" : "outline"}
                      size="sm"
                      className={cn(
                        'h-8 rounded-xl text-muted-foreground hover:text-foreground flex items-center',
                        iconOnly
                          ? 'w-8 px-0 justify-center border-0 bg-transparent shadow-none hover:bg-accent/50'
                          : 'px-3 py-2 gap-2 bg-transparent border border-border hover:bg-accent/50',
                      )}
                      disabled={isAttachDisabled}
                    >
                      {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                      {!iconOnly && <span className="text-sm">Attach</span>}
                    </Button>
                  </span>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" className="z-[60]">
                <p>{isLoggedIn ? 'Attach files' : 'Please login to attach files'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="start" className="z-[60]">
            <DropdownMenuItem
              onClick={() => setIsKnowledgePickerOpen(true)}
              disabled={isAttachDisabled}
            >
              From knowledge base
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleFileUpload} disabled={isAttachDisabled}>
              From device
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          type="file"
          ref={ref}
          className="hidden"
          onChange={processFileUpload}
          multiple
        />

        <KnowledgeBasePickerDialog
          open={isKnowledgePickerOpen}
          onOpenChange={setIsKnowledgePickerOpen}
          onSelect={handleAttachKnowledgeFile}
        />
      </>
    );
  },
);

FileUploadHandler.displayName = 'FileUploadHandler';
export { handleFiles, uploadFiles };
