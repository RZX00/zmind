'use client';

import React from 'react';

interface ProfilePictureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentImageUrl?: string;
  currentIconName?: string | null;
  currentIconColor?: string;
  currentBackgroundColor?: string;
  agentName?: string;
  onImageUpdate?: (url: string | null) => void;
  onIconUpdate?: (iconName: string | null, iconColor: string, backgroundColor: string) => void;
}

export const ProfilePictureDialog: React.FC<ProfilePictureDialogProps> = () => {
  // Soft-disabled UI; keep API shape compatible
  return null;
};

