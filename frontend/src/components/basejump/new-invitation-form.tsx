'use client';
import { useEffect, useRef, useState } from 'react';
import { SubmitButton } from '../ui/submit-button';
import { Label } from '../ui/label';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from '@/components/ui/select';
import { createInvitation } from '@/lib/actions/invitations';
import fullInvitationUrl from '@/lib/full-invitation-url';
import { usePathname, useRouter } from 'next/navigation';

type Props = {
  accountId: string;
};

export default function NewInvitationForm({ accountId }: Props) {
  const t = useTranslations('teamSettings');
  const router = useRouter();
  const pathname = usePathname();
  const [result, setResult] = useState<{ message?: string; token?: string } | null>(null);
  const hasRefreshedRef = useRef(false);
  const invitationOptions = [
    { label: t('invites.type24h'), value: '24_hour' },
    { label: t('invites.typeOneTime'), value: 'one_time' },
  ];
  const memberOptions = [
    { label: t('roles.owner'), value: 'owner' },
    { label: t('roles.member'), value: 'member' },
  ];

  useEffect(() => {
    if (!result?.token || hasRefreshedRef.current) {
      return;
    }
    hasRefreshedRef.current = true;
    router.refresh();
  }, [result?.token, router]);

  return (
    <form className="animate-in flex-1 flex flex-col w-full justify-center gap-y-6 text-foreground">
      {Boolean(result?.token) ? (
        <div className="text-sm">{fullInvitationUrl(result!.token!)}</div>
      ) : (
        <>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="refreshPath" value={pathname} />
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="invitationType">{t('labels.invitationType')}</Label>
            <Select defaultValue="one_time" name="invitationType">
              <SelectTrigger>
                <SelectValue placeholder={t('placeholders.invitationType')} />
              </SelectTrigger>
              <SelectContent>
                {invitationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="accountRole">{t('labels.teamRole')}</Label>
            <Select defaultValue="member" name="accountRole">
              <SelectTrigger>
                <SelectValue placeholder={t('placeholders.memberType')} />
              </SelectTrigger>
              <SelectContent>
                {memberOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SubmitButton
            formAction={createInvitation}
            pendingText={t('invites.creating')}
            onStateChange={(state) => {
              if (!state?.token) {
                hasRefreshedRef.current = false;
              }
              setResult(state);
            }}
          >
            {t('invites.create')}
          </SubmitButton>
        </>
      )}
    </form>
  );
}
