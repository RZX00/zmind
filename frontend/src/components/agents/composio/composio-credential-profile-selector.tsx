import React from 'react';
import type { ComposioProfile } from '@/hooks/react-query/composio/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface ComposioCredentialProfileSelectorProps {
  profiles: ComposioProfile[];
  value?: string;
  onChange: (value: string) => void;
  label?: string;
}

export const ComposioCredentialProfileSelector: React.FC<ComposioCredentialProfileSelectorProps> = ({
  profiles,
  value,
  onChange,
  label = 'Connection Profile',
}) => {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a profile" />
        </SelectTrigger>
        <SelectContent>
          {profiles.map(profile => (
            <SelectItem key={profile.profile_id} value={profile.profile_id}>
              {profile.profile_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

