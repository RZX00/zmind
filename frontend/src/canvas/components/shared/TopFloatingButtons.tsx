// 🎨 顶部栏按钮组件
// 提供代码编辑器和Agent面板的快捷访问（代码编辑器按钮仅对 super_admin 可见）

"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Code2 } from '@/components/ui/icons';
import { createClient } from '@/lib/supabase/client';
import {useTranslations} from 'next-intl';
import { useTheme } from 'next-themes';
import { fetchMyRoles } from '@/lib/backend-api';

interface TopFloatingButtonsProps {
  onCodeEditorToggle?: () => void;
  onAgentToggle?: (enabled: boolean) => void;
  showCodeEditor?: boolean;
  showAgentPanel?: boolean;
  showCodeButton?: boolean;
  showAIButton?: boolean;
  buttonClassName?: string;
  aiButtonClassName?: string;
  aiIconClassName?: string;
}

const TopFloatingButtons: React.FC<TopFloatingButtonsProps> = ({
  onCodeEditorToggle,
  onAgentToggle,
  showCodeEditor = false,
  showAgentPanel = false,
  showCodeButton = true,
  showAIButton = true,
  buttonClassName,
  aiButtonClassName,
  aiIconClassName,
}) => {
  const sizeClass = buttonClassName ?? 'w-8 h-8';
  const aiSizeClass = aiButtonClassName ?? 'w-10 h-10';
  const aiIconClass = aiIconClassName ?? 'h-5 w-5';
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const aiIconSrc = useMemo(() => (resolvedTheme === 'dark' ? '/ai-white.png' : '/ai.png'), [resolvedTheme]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 权限由服务端判定：前端不再直查 user_roles 表
        const roles = await fetchMyRoles();
        if (mounted) setIsSuperAdmin(roles.is_super_admin);
      } catch {
        if (mounted) setIsSuperAdmin(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const allowCodeButton = isSuperAdmin && showCodeButton && !!onCodeEditorToggle;

  return (
    <div className="flex items-center gap-1">
      {/* Code editor button */}
      {allowCodeButton && (
        <button
          onClick={() => onCodeEditorToggle && onCodeEditorToggle()}
          className={`
            ${sizeClass} rounded-md transition-colors duration-150
            flex items-center justify-center flex-shrink-0
            ${showCodeEditor
              ? 'bg-accent text-accent-foreground hover:bg-accent/90'
              : 'text-foreground hover:bg-accent/60'
            }
          `}
          title={t('canvas.codeEditor.title', {default: 'Code Editor'})}
        >
          <Code2 size={16} />
        </button>
      )}

      {/* AI assistant button (hidden when no toggle handler is provided) */}
      {showAIButton && onAgentToggle && (
        <button
          onClick={() => onAgentToggle && onAgentToggle(!showAgentPanel)}
          className={`
            ${aiSizeClass} rounded-md transition-colors duration-150
            flex items-center justify-center flex-shrink-0
            ${showAgentPanel
              ? 'bg-accent text-accent-foreground hover:bg-accent/90'
              : 'text-foreground hover:bg-accent/60'
            }
          `}
          title={t('canvas.aiAssistant.title', { default: 'AI Assistant' })}
        >
          <Image
            src={aiIconSrc}
            alt={t('canvas.aiAssistant.title', { default: 'AI Assistant' })}
            width={20}
            height={20}
            className={aiIconClass}
          />
        </button>
      )}
    </div>
  );
};

export default TopFloatingButtons;
