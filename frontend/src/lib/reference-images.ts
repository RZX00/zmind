export type ReferenceImageSource = 'chat-upload' | 'canvas-node';

export interface ReferenceImagePayload {
  id?: string;
  storagePath: string;
  fileId?: string;
  label?: string;
  width?: number;
  height?: number;
  nodeId?: string;
  source?: ReferenceImageSource;
}

export interface ReferenceImageInput {
  file_id?: string;
  storage_path?: string;
  node_id?: string;
  label?: string;
  width?: number;
  height?: number;
  source?: ReferenceImageSource;
}

export function toReferenceImageInput(image: ReferenceImagePayload): ReferenceImageInput {
  return {
    file_id: image.fileId,
    storage_path: image.storagePath,
    node_id: image.nodeId,
    label: image.label,
    width: image.width,
    height: image.height,
    source: image.source,
  };
}

export function fromReferenceImageInput(image: ReferenceImageInput): ReferenceImagePayload | null {
  if (!image || !(image.file_id || image.storage_path || image.node_id)) {
    return null;
  }
  return {
    storagePath: image.storage_path || '',
    fileId: image.file_id,
    nodeId: image.node_id,
    label: image.label,
    width: image.width,
    height: image.height,
    source: image.source,
  };
}

export interface ReferenceImageEventDetail {
  images: ReferenceImagePayload[];
}

export const REFERENCE_IMAGE_EVENT = 'canvas:add-reference-images';
export const SET_REFERENCE_IMAGE_EVENT = 'canvas:set-reference-images';

export function dispatchReferenceImages(images: ReferenceImagePayload[]): void {
  if (!images?.length) return;
  try {
    window.dispatchEvent(
      new CustomEvent<ReferenceImageEventDetail>(REFERENCE_IMAGE_EVENT, {
        detail: { images },
      }),
    );
  } catch {
    // noop – window unavailable (e.g., SSR)
  }
}

export function dispatchSetReferenceImages(images: ReferenceImagePayload[]): void {
  try {
    window.dispatchEvent(
      new CustomEvent<ReferenceImageEventDetail>(SET_REFERENCE_IMAGE_EVENT, {
        detail: { images: images || [] },
      }),
    );
  } catch {
    // noop
  }
}
