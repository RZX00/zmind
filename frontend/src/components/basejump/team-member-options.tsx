'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { GetAccountMembersResponse } from '@usebasejump/shared';
import { useEffect, useState } from 'react';
import {
  DialogHeader,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import EditTeamMemberRoleForm from './edit-team-member-role-form';
import DeleteTeamMemberForm from './delete-team-member-form';
import { useTranslations } from 'next-intl';

type Props = {
  accountId: string;
  teamMember: GetAccountMembersResponse[0];
  isPrimaryOwner: boolean;
};

export default function TeamMemberOptions({
  teamMember,
  accountId,
  isPrimaryOwner,
}: Props) {
  const t = useTranslations('teamSettings');
  const [updateTeamRole, toggleUpdateTeamRole] = useState(false);
  const [removeTeamMember, toggleRemoveTeamMember] = useState(false);

  useEffect(() => {
    if (updateTeamRole) {
      toggleUpdateTeamRole(false);
    }
  }, [teamMember.account_role, updateTeamRole]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-8 p-0 rounded-full hover:bg-hover-bg dark:hover:bg-hover-bg-dark"
          >
            <MoreHorizontal className="h-4 w-4 text-foreground/70" />
            <span className="sr-only">{t('actions.openMenu')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[160px]">
          <DropdownMenuItem
            onSelect={() => toggleUpdateTeamRole(true)}
            className="rounded-md hover:bg-hover-bg cursor-pointer text-foreground/90"
          >
            {t('actions.changeRole')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => toggleRemoveTeamMember(true)}
            className="rounded-md hover:bg-hover-bg cursor-pointer text-red-500 dark:text-red-400"
          >
            {t('actions.removeMember')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={updateTeamRole} onOpenChange={toggleUpdateTeamRole}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-card-title">
              {t('actions.updateRoleTitle')}
            </DialogTitle>
            <DialogDescription className="text-foreground/70">
              {t('actions.updateRoleDesc')}
            </DialogDescription>
          </DialogHeader>
          <EditTeamMemberRoleForm
            teamMember={teamMember}
            accountId={accountId}
            isPrimaryOwner={isPrimaryOwner}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={removeTeamMember} onOpenChange={toggleRemoveTeamMember}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-card-title">
              {t('actions.removeMemberTitle')}
            </DialogTitle>
            <DialogDescription className="text-foreground/70">
              {t('actions.removeMemberDesc')}
            </DialogDescription>
          </DialogHeader>
          <DeleteTeamMemberForm teamMember={teamMember} accountId={accountId} />
        </DialogContent>
      </Dialog>
    </>
  );
}
