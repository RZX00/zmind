'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModelSelection } from '@/hooks/use-model-selection';

interface AgentModelSelectorProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  variant?: 'default' | 'compact' | string;
}

export const AgentModelSelector: React.FC<AgentModelSelectorProps> = ({ value, onChange, disabled, variant = 'default' }) => {
  const { availableModels, isLoading } = useModelSelection();

  const safeValue = value && availableModels.some((model) => model.id === value) ? value : undefined;

  return (
    <Select value={safeValue} onValueChange={onChange} disabled={disabled || isLoading || availableModels.length === 0}>
      <SelectTrigger className={variant === 'compact' ? 'h-8 text-sm' : ''}>
        <SelectValue placeholder={isLoading ? 'Loading models...' : 'Select a model'} />
      </SelectTrigger>
      <SelectContent>
        {availableModels.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
