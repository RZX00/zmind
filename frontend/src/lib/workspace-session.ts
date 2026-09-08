"use client";

let currentWorkspaceId: string | null = null;
const WORKSPACE_GLOBAL_KEY = '__zmind_workspace_id__';

export function setCurrentWorkspaceId(id: string | null) {
  currentWorkspaceId = id;
  if (typeof globalThis !== 'undefined') {
    (globalThis as any)[WORKSPACE_GLOBAL_KEY] = id;
  }
}

export function getCurrentWorkspaceId() {
  return currentWorkspaceId;
}

