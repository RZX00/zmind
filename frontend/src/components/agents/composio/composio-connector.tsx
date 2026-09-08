import React, { useState } from 'react';
import Image from 'next/image';
import type { ComposioToolkit, ComposioProfile } from '@/hooks/react-query/composio/utils';
import { Button } from '@/components/ui/button';
import { useCreateComposioProfile } from '@/hooks/react-query/composio/use-composio';
import { useComposioProfiles } from '@/hooks/react-query/composio/use-composio-profiles';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface ComposioConnectorProps {
  app: ComposioToolkit;
  mode?: 'full' | 'profile-only';
  onConnected: (profileId: string, appName: string, appSlug: string) => void;
  onClose?: () => void;
}

export const ComposioConnector: React.FC<ComposioConnectorProps> = ({
  app,
  mode = 'full',
  onConnected,
  onClose,
}) => {
  const { data: profilesData } = useComposioProfiles();
  const createProfile = useCreateComposioProfile();
  const [selectedProfileId, setSelectedProfileId] = useState<string | 'new' | ''>('');
  const [profileName, setProfileName] = useState('');

  const existingProfiles: ComposioProfile[] =
    profilesData?.filter(p => p.toolkit_slug === app.slug) || [];

  const handleConnect = async () => {
    if (selectedProfileId && selectedProfileId !== 'new') {
      onConnected(selectedProfileId, app.name, app.slug);
      onClose?.();
      return;
    }

    if (!profileName.trim()) return;

    const result = await createProfile.mutateAsync({
      toolkit_slug: app.slug,
      profile_name: profileName.trim(),
    });

    if (result.profile_id) {
      onConnected(result.profile_id, app.name, app.slug);
      onClose?.();
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        {app.logo ? (
          <Image
            src={app.logo}
            alt={app.name}
            width={40}
            height={40}
            unoptimized
            loader={({ src }) => src}
            className="w-10 h-10 rounded-xl border bg-muted object-contain p-2"
          />
        ) : (
          <div className="w-10 h-10 rounded-xl border bg-muted flex items-center justify-center">
            <span className="text-base font-medium">{app.name.charAt(0)}</span>
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold">{app.name}</h2>
          <p className="text-xs text-muted-foreground">
            Connect {app.name} to enable agent tools.
          </p>
        </div>
      </div>

      {existingProfiles.length > 0 && (
        <div className="space-y-2">
          <Label>Use existing connection</Label>
          <Select
            value={selectedProfileId}
            onValueChange={(value) => setSelectedProfileId(value as any)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an existing profile or create new" />
            </SelectTrigger>
            <SelectContent>
              {existingProfiles.map((profile) => (
                <SelectItem key={profile.profile_id} value={profile.profile_id}>
                  {profile.profile_name}
                </SelectItem>
              ))}
              <SelectItem value="new">Create new profile</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {(selectedProfileId === '' || selectedProfileId === 'new' || existingProfiles.length === 0) && (
        <div className="space-y-2">
          <Label>Create new connection profile</Label>
          <Input
            placeholder={`${app.name} workspace name (e.g. "Marketing Team")`}
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          type="button"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleConnect}
          disabled={createProfile.isPending || (!selectedProfileId && !profileName.trim())}
        >
          {createProfile.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </div>
    </div>
  );
};
