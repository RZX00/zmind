'use client';

import { SubmitButton } from '../ui/submit-button';
import { removeTeamMember } from '@/lib/actions/members';
import { GetAccountMembersResponse } from '@usebasejump/shared';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Props = {
  accountId: string;
  teamMember: GetAccountMembersResponse[0];
};

export default function DeleteTeamMemberForm({ accountId, teamMember }: Props) {
  const t = useTranslations('teamSettings');
  const pathName = usePathname();

  return (
    <form className="animate-in flex-1 flex flex-col w-full justify-center gap-y-6 text-foreground">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="userId" value={teamMember.user_id} />
      <input type="hidden" name="returnUrl" value={pathName} />

      <SubmitButton
        variant="destructive"
        formAction={removeTeamMember}
        pendingText={t('actions.removePending')}
      >
        {t('actions.removeMember')}
      </SubmitButton>
    </form>
  );
}
