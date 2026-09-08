'use client';

import { useFormStatus } from 'react-dom';
import { useActionState, useState } from 'react';
import { type ComponentProps, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from './alert';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = Omit<ComponentProps<typeof Button>, 'formAction'> & {
  pendingText?: string;
  formAction: (prevState: any, formData: FormData) => Promise<any>;
  errorMessage?: string;
  onStateChange?: (state: any) => void;
  fullWidth?: boolean;
  containerClassName?: string;
};

const initialState = {
  message: '',
};

export function SubmitButton({
  children,
  formAction,
  errorMessage,
  pendingText = 'Submitting...',
  onStateChange,
  fullWidth = true,
  containerClassName,
  ...props
}: Props) {
  const { pending, action } = useFormStatus();
  const [state, internalFormAction] = useActionState(formAction, initialState);

  const isPending = pending && action === internalFormAction;
  const [interacted, setInteracted] = useState(false);

  // Expose state changes to parent when needed (e.g., to read tokens)
  useEffect(() => {
    if (!onStateChange) return;
    // Avoid firing on initial mount before any interaction
    if (!interacted && !state?.message && !(state as any)?.ok) return;
    onStateChange(state);
  }, [state, onStateChange, interacted]);

  const wrapperClassName = cn(
    'flex flex-col gap-y-4',
    fullWidth ? 'w-full' : 'w-auto',
    containerClassName,
  );

  return (
    <div className={wrapperClassName}>
      {Boolean(errorMessage || state?.message) && (
        <Alert variant="destructive" className="w-full">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{errorMessage || state?.message}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button
          {...props}
          type="submit"
          aria-disabled={pending}
          formAction={internalFormAction}
          onClick={(e) => {
            setInteracted(true);
            // Preserve any consumer onClick
            // @ts-ignore - props typing already includes onClick
            props?.onClick?.(e);
          }}
        >
          {isPending ? pendingText : children}
        </Button>
      </div>
    </div>
  );
}
