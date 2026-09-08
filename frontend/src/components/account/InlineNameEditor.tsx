"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { editPersonalAccountName } from '@/lib/actions/personal-account';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type Props = {
  accountId: string;
  initialName: string;
  label?: string;
  formAction?: (prevState: any, formData: FormData) => Promise<any>;
  successMessage?: string;
};

export default function InlineNameEditor({
  accountId,
  initialName,
  label = '用户名',
  formAction = editPersonalAccountName,
  successMessage = '已保存用户名',
}: Props) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (editing) {
      // Focus the input when entering edit mode
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing]);

  return (
    <div className="py-5 flex items-center gap-8">
      <div className="w-20 text-sm text-muted-foreground">{label}</div>

      {editing ? (
        <form className="flex items-center gap-3 flex-1" onSubmit={() => { /* handled by SubmitButton */ }}>
          <input type="hidden" name="accountId" value={accountId} />
          <Input
            name="name"
            defaultValue={initialName}
            className="h-9 max-w-sm"
            required
            ref={inputRef}
          />
          <div className="ml-auto flex items-center gap-2">
            <SubmitButton
              formAction={formAction}
              pendingText="保存中..."
              className="h-9 px-3 text-sm rounded-md"
              onStateChange={async (state) => {
                if ((state as any)?.ok) {
                  // Refresh current route and invalidate accounts cache so sidebar updates
                  await queryClient.invalidateQueries({ queryKey: ['accounts'] });
                  router.refresh();
                  setEditing(false);
                  toast.success(successMessage);
                } else if ((state as any)?.message) {
                  toast.error(state.message);
                }
              }}
            >
              保存
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              className="h-9 px-3 text-sm"
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div
            className="text-base text-foreground font-medium cursor-text"
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setEditing(true);
            }}
          >
            {initialName}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-9 px-3 text-sm rounded-md"
            onClick={() => setEditing(true)}
          >
            编辑
          </Button>
        </>
      )}
    </div>
  );
}
