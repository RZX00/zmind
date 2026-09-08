import { SERVER_URL } from '@/constants/Server';
import { createSupabaseClient } from '@/constants/SupabaseConfig';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

export interface UploadedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  localUri?: string;
  isUploading?: boolean;
  uploadError?: string;
  cachedBlob?: Blob;
  fileId?: string;
  storagePath?: string;
}

export interface FileUploadResult {
  success: boolean;
  files: UploadedFile[];
  error?: string;
}

// File size limit (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

interface UploadIntentResponse {
  file_id: string;
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  storage_key: string;
  expires_in: number;
  reuse?: boolean;
  upload_id?: string;
  part_size?: number;
  part_count?: number;
  parts?: Array<{ part_number: number; url: string }>;
  resume?: boolean;
}

interface UploadCompletePart {
  part_number: number;
  etag: string;
}

// Normalize filename to NFC (Unicode normalization)
const normalizeFilenameToNFC = (filename: string): string => {
  return filename.normalize('NFC');
};

// Show file picker options
export const showFilePickerOptions = (): Promise<{ cancelled: boolean; files?: any[] }> => {
  return new Promise((resolve) => {
    Alert.alert(
      'Add Files',
      'Choose how you want to add files',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve({ cancelled: true }) },
        { 
          text: 'Camera', 
          onPress: async () => {
            const result = await pickFromCamera();
            resolve(result);
          }
        },
        { 
          text: 'Photo Library', 
          onPress: async () => {
            const result = await pickFromImageLibrary();
            resolve(result);
          }
        },
        { 
          text: 'Documents', 
          onPress: async () => {
            const result = await pickFromDocuments();
            resolve(result);
          }
        },
      ],
      { cancelable: true, onDismiss: () => resolve({ cancelled: true }) }
    );
  });
};

// Pick from camera
const pickFromCamera = async (): Promise<{ cancelled: boolean; files?: any[] }> => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  
  if (status !== 'granted') {
    Alert.alert('Permission Required', 'Camera permission is required to take photos.');
    return { cancelled: true };
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsEditing: false,
    quality: 0.8,
  });

  if (result.canceled) {
    return { cancelled: true };
  }

  return { cancelled: false, files: result.assets };
};

// Pick from image library
const pickFromImageLibrary = async (): Promise<{ cancelled: boolean; files?: any[] }> => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  
  if (status !== 'granted') {
    Alert.alert('Permission Required', 'Photo library permission is required to select images.');
    return { cancelled: true };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsEditing: false,
    allowsMultipleSelection: true,
    quality: 0.8,
  });

  if (result.canceled) {
    return { cancelled: true };
  }

  return { cancelled: false, files: result.assets };
};

// Pick from documents
const pickFromDocuments = async (): Promise<{ cancelled: boolean; files?: any[] }> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });

  if (result.canceled) {
    return { cancelled: true };
  }

  return { cancelled: false, files: result.assets };
};

// Helper function to create blob from file URI
const createBlobFromUri = async (uri: string, mimeType: string): Promise<Blob | null> => {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    
    // Ensure correct MIME type
    if (blob.type !== mimeType) {
      return new Blob([blob], { type: mimeType });
    }
    
    return blob;
  } catch (error) {
    console.warn('[FILE_UPLOAD] Failed to create blob from URI:', error);
    return null;
  }
};

const getAccessToken = async (): Promise<string> => {
  const supabase = createSupabaseClient();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error('Authentication required');
  }
  return session.access_token;
};

const createUploadIntent = async (
  token: string,
  fileName: string,
  fileSize: number,
  contentType: string,
  source: string
): Promise<UploadIntentResponse> => {
  const response = await fetch(`${SERVER_URL}/files/upload-intent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: fileName,
      size: fileSize,
      content_type: contentType,
      source,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Upload intent failed');
    throw new Error(errorText || `Upload intent failed: ${response.status}`);
  }
  return response.json();
};

const completeUpload = async (
  token: string,
  fileId: string,
  opts?: { uploadId?: string; parts?: UploadCompletePart[] }
) => {
  const response = await fetch(`${SERVER_URL}/files/upload-complete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: fileId,
      upload_id: opts?.uploadId,
      parts: opts?.parts,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Upload complete failed: ${response.status}`);
  }
};

const abortUpload = async (token: string, fileId: string) => {
  try {
    await fetch(`${SERVER_URL}/files/upload-abort`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId }),
    });
  } catch {
    // swallow abort errors
  }
};

const uploadMultipart = async (
  fileBlob: Blob,
  intent: UploadIntentResponse
) => {
  const partSize = intent.part_size || 8 * 1024 * 1024;
  const partCount = intent.part_count || Math.ceil(fileBlob.size / Math.max(1, partSize));
  const parts = intent.parts || [];

  const uploadedParts: UploadCompletePart[] = [];
  for (let idx = 1; idx <= partCount; idx += 1) {
    const start = (idx - 1) * partSize;
    const end = Math.min(start + partSize, fileBlob.size);
    const chunk = fileBlob.slice(start, end);
    const part = parts.find((p) => p.part_number === idx);
    if (!part?.url) {
      throw new Error(`Missing upload URL for part ${idx}`);
    }
    const resp = await fetch(part.url, {
      method: 'PUT',
      body: chunk,
    });
    if (!resp.ok) {
      throw new Error(`Upload part ${idx} failed: ${resp.status} ${resp.statusText}`);
    }
    const etag = resp.headers.get('ETag') || resp.headers.get('etag');
    if (etag) {
      uploadedParts.push({ part_number: idx, etag });
    }
  }

  return uploadedParts;
};

const uploadWithIntent = async (
  token: string,
  fileBlob: Blob,
  intent: UploadIntentResponse,
  contentType: string
): Promise<UploadIntentResponse> => {
  const method = (intent.method || 'PUT').toUpperCase();
  try {
    if (method === 'MULTIPART') {
      const parts = await uploadMultipart(fileBlob, intent);
      await completeUpload(token, intent.file_id, {
        uploadId: intent.upload_id,
        parts: parts.length ? parts : undefined,
      });
      return intent;
    }

    const uploadResp = await fetch(intent.upload_url, {
      method: intent.method || 'PUT',
      headers: intent.headers || { 'Content-Type': contentType },
      body: fileBlob,
    });
    if (!uploadResp.ok) {
      throw new Error(`Upload failed: ${uploadResp.status} ${uploadResp.statusText}`);
    }
    await completeUpload(token, intent.file_id);
    return intent;
  } catch (error) {
    await abortUpload(token, intent.file_id);
    throw error;
  }
};

const uploadFileWithIntent = async (
  token: string,
  fileBlob: Blob,
  fileName: string,
  fileSize: number,
  contentType: string,
  source: string
): Promise<UploadIntentResponse> => {
  const intent = await createUploadIntent(token, fileName, fileSize, contentType, source);
  if (intent.reuse) return intent;
  return uploadWithIntent(token, fileBlob, intent, contentType);
};

// Handle local files (when no sandbox) - show immediately
export const handleLocalFiles = async (
  files: any[],
  setPendingFiles: (files: File[]) => void,
  addUploadedFiles: (files: UploadedFile[]) => void
): Promise<UploadedFile[]> => {
  const validFiles: UploadedFile[] = [];

  for (const file of files) {
    if (file.size && file.size > MAX_FILE_SIZE) {
      Alert.alert('File Too Large', `File size exceeds 50MB limit: ${file.name || 'Unknown file'}`);
      continue;
    }

    const fileName = file.name || file.fileName || 'unknown_file';
    const normalizedName = normalizeFilenameToNFC(fileName);
    const mimeType = file.mimeType || file.type || 'application/octet-stream';
    
    // Create blob for optimistic caching (images only)
    let cachedBlob: Blob | undefined;
    if (file.uri && mimeType.startsWith('image/')) {
      cachedBlob = await createBlobFromUri(file.uri, mimeType) || undefined;
    }
    
    const uploadedFile: UploadedFile = {
      name: normalizedName,
      path: `/workspace/${normalizedName}`,
      size: file.size || 0,
      type: mimeType,
      localUri: file.uri,
      isUploading: false, // Local files don't need uploading
      cachedBlob,
    };

    validFiles.push(uploadedFile);
  }

  if (validFiles.length > 0) {
    addUploadedFiles(validFiles);
  }

  return validFiles;
};

// Upload files to sandbox - show immediately with loading state
export const uploadFilesToStorage = async (
  files: any[],
  addUploadedFiles: (files: UploadedFile[]) => void,
  updateFileStatus: (path: string, status: { isUploading?: boolean; uploadError?: string; fileId?: string; storagePath?: string; path?: string }) => void
): Promise<FileUploadResult> => {
  const uploadedFiles: UploadedFile[] = [];
  let token: string | null = null;

  // First, create intents and show files immediately with loading state + optimistic caching
  for (const file of files) {
    if (file.size && file.size > MAX_FILE_SIZE) {
      continue;
    }

    const fileName = file.name || file.fileName || 'unknown_file';
    const normalizedName = normalizeFilenameToNFC(fileName);
    const mimeType = file.mimeType || file.type || 'application/octet-stream';

    let uploadKey: string | null = null;
    try {
      if (!token) {
        token = await getAccessToken();
      }
      const fileBlob = await createBlobFromUri(file.uri, mimeType);
      if (!fileBlob) {
        throw new Error('Failed to read file content');
      }
      const intent = await createUploadIntent(
        token,
        normalizedName,
        file.size || fileBlob.size || 0,
        mimeType,
        'chat'
      );
      const storagePath = intent.storage_key || intent.file_id;
      uploadKey = storagePath;

      let cachedBlob: Blob | undefined;
      if (mimeType.startsWith('image/')) {
        cachedBlob = fileBlob;
      }

      const uploadedFile: UploadedFile = {
        name: normalizedName,
        path: storagePath,
        size: file.size || fileBlob.size || 0,
        type: mimeType,
        localUri: file.uri,
        isUploading: !intent.reuse,
        cachedBlob,
        fileId: intent.file_id,
        storagePath: intent.storage_key,
      };

      addUploadedFiles([uploadedFile]);

      if (intent.reuse) {
        updateFileStatus(storagePath, { isUploading: false, fileId: intent.file_id, storagePath: intent.storage_key });
        uploadedFiles.push({ ...uploadedFile, isUploading: false });
        continue;
      }

      await uploadWithIntent(token, fileBlob, intent, mimeType);
      updateFileStatus(storagePath, { isUploading: false, fileId: intent.file_id, storagePath: intent.storage_key });
      uploadedFiles.push({ ...uploadedFile, isUploading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      
      // Update file status to error
      const statusKey = uploadKey || normalizedName;
      updateFileStatus(statusKey, {
        isUploading: false, 
        uploadError: errorMessage 
      });

      console.error(`Failed to upload ${normalizedName}:`, error);
    }
  }

  return { success: uploadedFiles.length > 0, files: uploadedFiles };
};

// Main file picker function
export const pickFiles = async (): Promise<{ cancelled: boolean; files?: any[] }> => {
  return await showFilePickerOptions();
}; 
