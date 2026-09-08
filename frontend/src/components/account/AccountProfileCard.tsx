"use client";

import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import InlineNameEditor from '@/components/account/InlineNameEditor';
import { editTeamName } from '@/lib/actions/teams';

type AccountProfileCardProps = {
  user: any | null;
  account: any | null;
  isPersonal?: boolean;
  compact?: boolean;
};

export default function AccountProfileCard({
  user,
  account,
  isPersonal,
  compact = false,
}: AccountProfileCardProps) {
  const isPersonalAccount = isPersonal ?? Boolean(account?.personal_account);
  const name =
    account?.name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    '';
  const email = isPersonalAccount ? account?.email || user?.email || '' : '';
  const provider = isPersonalAccount
    ? (user?.app_metadata as any)?.provider ||
      (user?.identities && user.identities[0]?.provider) ||
      '—'
    : '';
  const roleLabel = !isPersonalAccount
    ? (account?.role
        ? account.role
            .split('_')
            .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
        : 'Member')
    : '';
  const nameLabel = isPersonalAccount ? '用户名' : '团队名称';
  const successMessage = isPersonalAccount ? '已保存用户名' : '已保存团队名称';
  const nameFormAction = isPersonalAccount ? undefined : editTeamName;

  const initials = (name || 'U')
    .split(' ')
    .map((p: string) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (compact) {
    return (
      <div className="w-full">
        <div className="mb-4 flex items-center justify-center">
          <Avatar className="h-28 w-28 aspect-square rounded-full">
            <AvatarFallback className="text-3xl font-semibold rounded-full">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="mt-2 flex flex-col">
          <InlineNameEditor
            accountId={account?.account_id}
            initialName={name}
            label={nameLabel}
            formAction={nameFormAction}
            successMessage={successMessage}
          />
          <Separator className="my-2 border-subtle dark:border-white/10" />
          {isPersonalAccount ? (
            <>
              <div className="flex items-center gap-8 py-5">
                <div className="w-20 text-sm text-muted-foreground">邮箱</div>
                <div className="break-all text-base text-foreground">{email}</div>
              </div>
              <Separator className="my-2 border-subtle dark:border-white/10" />
              <div className="flex items-center gap-8 py-5">
                <div className="w-20 text-sm text-muted-foreground">登录方式</div>
                <div className="text-base capitalize text-foreground">
                  {provider}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-8 py-5">
              <div className="w-20 text-sm text-muted-foreground">角色</div>
              <div className="text-base capitalize text-foreground">
                {roleLabel}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="px-6 py-6">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-4">
            <h1 className="text-base font-medium text-foreground">账户设置</h1>
            <p className="mt-1 text-xs text-muted-foreground">管理你的账户信息</p>
          </div>

          <div
            className="relative mx-auto w-full max-w-[680px]"
            style={{ aspectRatio: '5 / 4' }}
          >
            <Card className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border-subtle bg-card px-7 py-8 shadow-sm dark:border-white/10">
              <div className="mb-5 flex items-center justify-center">
                <Avatar className="h-36 w-36">
                  <AvatarFallback className="text-3xl font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="mt-2 flex flex-col">
                <InlineNameEditor
                  accountId={account?.account_id}
                  initialName={name}
                  label={nameLabel}
                  formAction={nameFormAction}
                  successMessage={successMessage}
                />
                <Separator className="my-2 border-subtle dark:border-white/10" />
                {isPersonalAccount ? (
                  <>
                    <div className="flex items-center gap-8 py-5">
                      <div className="w-20 text-sm text-muted-foreground">邮箱</div>
                      <div className="break-all text-base text-foreground">
                        {email}
                      </div>
                    </div>
                    <Separator className="my-2 border-subtle dark:border-white/10" />
                    <div className="flex items-center gap-8 py-5">
                      <div className="w-20 text-sm text-muted-foreground">
                        登录方式
                      </div>
                      <div className="text-base capitalize text-foreground">
                        {provider}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-8 py-5">
                    <div className="w-20 text-sm text-muted-foreground">角色</div>
                    <div className="text-base capitalize text-foreground">
                      {roleLabel}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
