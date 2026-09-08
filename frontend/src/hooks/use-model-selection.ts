'use client';

import { useModelStore } from '@/lib/stores/model-store';
import { useSubscriptionData } from '@/contexts/SubscriptionContext';
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAvailableModels } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
  providerLabel: string;
  requiresSubscription: boolean;
  isAvailable: boolean;
  providerBlocked: boolean;
  isSponsored: boolean;
  sponsorBadge?: string;
  description?: string;
  priority?: number;
  recommended?: boolean;
  capabilities?: string[];
  contextWindow?: number;
}

const sortModels = (models: ModelOption[]): ModelOption[] => {
  return [...models].sort((a, b) => {
    if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1;
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (a.priority !== b.priority) return (b.priority || 0) - (a.priority || 0);
    if (a.providerLabel !== b.providerLabel) return a.providerLabel.localeCompare(b.providerLabel);
    return a.label.localeCompare(b.label);
  });
};

const getDefaultModel = (
  models: ModelOption[],
  preferredProvider?: string | null,
): string => {
  if (!models.length) return '';

  const scoped = preferredProvider
    ? models.filter((model) => model.providerId === preferredProvider)
    : [];
  const target = scoped.length > 0 ? scoped : models;

  const recommended = target.find((model) => model.recommended);
  if (recommended) return recommended.id;

  const byPriority = [...target].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (byPriority.length > 0) return byPriority[0].id;

  return target[0].id;
};

export const useModelSelection = () => {
  const { isLoading: authLoading } = useAuth();

  const {
    data: modelsData,
    isLoading: modelsLoading,
    isError: modelsError,
    error,
    refetch: refetchModels,
    isFetching,
  } = useQuery({
    queryKey: ['models', 'available'],
    queryFn: getAvailableModels,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 2,
    enabled: true,
  });

  const { data: subscriptionData } = useSubscriptionData();
  const { selectedModel, setSelectedModel } = useModelStore();
  const isLoading = authLoading || modelsLoading || isFetching;

  const availableModels = useMemo<ModelOption[]>(() => {
    if (!modelsData?.models) return [];

    const languageModels = modelsData.models.filter((model) => {
      // Availability follows model capabilities, not whether token pricing is known.
      return model.capabilities?.includes('chat') === true;
    });

    return sortModels(
      languageModels.map((model) => ({
        id: model.id,
        label: model.display_name || model.id,
        providerId: model.provider_id || 'unknown',
        providerLabel: model.provider_display_name || model.provider_id || 'Unknown',
        requiresSubscription: model.requires_subscription || false,
        isAvailable: model.is_available ?? !(model.requires_subscription || false),
        providerBlocked: model.provider_blocked || false,
        isSponsored: model.is_sponsored || false,
        sponsorBadge: model.sponsor_badge || undefined,
        priority: model.priority || 0,
        recommended: model.recommended || false,
        capabilities: model.capabilities || [],
        contextWindow: model.context_window || 128000,
      })),
    );
  }, [modelsData]);

  const accessibleModels = useMemo(() => {
    return availableModels.filter((model) => model.isAvailable && !model.providerBlocked);
  }, [availableModels]);

  useEffect(() => {
    if (isLoading || !availableModels.length) return;

    if (selectedModel) {
      const inAvailable = availableModels.some((model) => model.id === selectedModel);
      const inAccessible = accessibleModels.some((model) => model.id === selectedModel);
      if (inAvailable && inAccessible) {
        return;
      }

      const legacyModel = modelsData?.models?.find((model) => model.short_name === selectedModel || model.id === selectedModel);
      if (legacyModel?.id && legacyModel.id !== selectedModel) {
        setSelectedModel(legacyModel.id);
        return;
      }
    }

    const preferredProvider = modelsData?.provider_policy?.default_provider;
    const next = getDefaultModel(accessibleModels, preferredProvider);
    if (next) {
      setSelectedModel(next);
    }
  }, [
    selectedModel,
    accessibleModels,
    availableModels,
    isLoading,
    setSelectedModel,
    modelsData,
  ]);

  const handleModelChange = (modelId: string) => {
    const model = accessibleModels.find((option) => option.id === modelId);
    if (model) {
      setSelectedModel(modelId);
    }
  };

  return {
    selectedModel,
    setSelectedModel: handleModelChange,
    availableModels: accessibleModels,
    allModels: availableModels,
    isLoading,
    modelsError: modelsError ? (error as Error | null) : null,
    modelsData,
    subscriptionStatus: subscriptionData?.status === 'active' ? ('active' as const) : ('no_subscription' as const),
    canAccessModel: (modelId: string) => {
      return accessibleModels.some((model) => model.id === modelId);
    },
    isSubscriptionRequired: (modelId: string) => {
      const model = availableModels.find((option) => option.id === modelId);
      return model?.requiresSubscription || false;
    },

    handleModelChange,
    customModels: [] as any[],
    addCustomModel: (_model: any) => {},
    updateCustomModel: (_id: string, _model: any) => {},
    removeCustomModel: (_id: string) => {},

    getActualModelId: (modelId: string) => {
      const match = availableModels.find((option) => option.id === modelId);
      return match?.id || modelId;
    },

    refreshCustomModels: () => {
      try {
        void refetchModels();
      } catch {}
    },
  };
};
