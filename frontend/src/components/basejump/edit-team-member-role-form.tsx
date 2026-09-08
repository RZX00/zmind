'use client';

import { SubmitButton } from '../ui/submit-button';
import { Label } from '../ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { updateTeamMemberRole } from '@/lib/actions/members';
import { GetAccountMembersResponse } from '@usebasejump/shared';
import { useState } from 'react';
import { Checkbox } from '../ui/checkbox';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Props = {
  accountId: string;
  isPrimaryOwner: boolean;
  teamMember: GetAccountMembersResponse[0];
};

export default function EditTeamMemberRoleForm({
  accountId,
  teamMember,
  isPrimaryOwner,
}: Props) {
  const t = useTranslations('teamSettings');
  const [teamRole, setTeamRole] = useState(teamMember.account_role as string);
  const pathName = usePathname();
  const memberOptions = [
    { label: t('roles.owner'), value: 'owner' },
    { label: t('roles.member'), value: 'member' },
  ];

  return (
    <form className="animate-in flex-1 flex flex-col w-full justify-center gap-y-6 text-foreground">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="userId" value={teamMember.user_id} />
      <input type="hidden" name="returnUrl" value={pathName} />
      <div className="flex flex-col gap-y-2">
        <Label htmlFor="accountRole">{t('labels.teamRole')}</Label>
        <Select value={teamRole} onValueChange={setTeamRole} name="accountRole">
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
      {teamRole === 'owner' && isPrimaryOwner && (
        <div className="flex items-center space-x-2">
          <Checkbox id="makePrimaryOwner" name="makePrimaryOwner" />
          <label
            htmlFor="makePrimaryOwner"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {t('actions.makePrimaryOwner')}
          </label>
        </div>
      )}
      <SubmitButton formAction={updateTeamMemberRole} pendingText={t('actions.updatePending')}>
        {t('actions.updateRole')}
      </SubmitButton>
    </form>
  );
}
