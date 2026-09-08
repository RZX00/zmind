'use client';

import React from 'react';
import {useTranslations} from 'next-intl';
import { Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface KBDeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName: string;
  itemType: 'folder' | 'file';
  isDeleting: boolean;
}

export function KBDeleteConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  itemType,
  isDeleting,
}: KBDeleteConfirmDialogProps) {
  const t = useTranslations();
  const title = itemType === 'folder' ? t('knowledge.confirm.deleteFolder.title', {default: 'Delete folder'}) : t('knowledge.confirm.deleteFile.title', {default: 'Delete file'});
  const description = itemType === 'folder'
    ? t('knowledge.confirm.deleteFolder.desc', {name: itemName, default: `Are you sure you want to delete the folder "${itemName}"? This will permanently delete all files inside the folder. This action cannot be undone.`})
    : t('knowledge.confirm.deleteFile.desc', {name: itemName, default: `Are you sure you want to delete the file "${itemName}"? This action cannot be undone.`});

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('common.cancel', {default: 'Cancel'})}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isDeleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('knowledge.deleting', {default: 'Deleting...'})}
              </>
            ) : (
              t('common.delete', {default: 'Delete'})
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
