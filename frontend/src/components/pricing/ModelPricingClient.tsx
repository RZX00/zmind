"use client";

import { AlertCircle, Globe, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Model } from "@/lib/api";
import { useMemo, useState } from "react";
import {useTranslations} from 'next-intl';
import { useModelSelection } from "@/hooks/use-model-selection";

// Example task data with token usage
const exampleTasks = [
  {
    name: "Social Automation System",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 3410337,
    outputTokens: 93616,
    duration: "35 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Content Marketing Strategy",
    complexity: "Standard Complexity",
    complexityVariant: "secondary" as const,
    inputTokens: 212312,
    outputTokens: 3378,
    duration: "11 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Go-to-Market Strategy",
    complexity: "Standard Complexity",
    complexityVariant: "secondary" as const,
    inputTokens: 307719,
    outputTokens: 24033,
    duration: "16 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Learning Path Generator",
    complexity: "Standard Complexity",
    complexityVariant: "secondary" as const,
    inputTokens: 90953,
    outputTokens: 17472,
    duration: "5 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Customer Journey Mapping",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 360013,
    outputTokens: 17287,
    duration: "20 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Sales Funnel Optimization",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 559918,
    outputTokens: 33392,
    duration: "14 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Startup Pitch Deck",
    complexity: "Standard Complexity",
    complexityVariant: "secondary" as const,
    inputTokens: 169175,
    outputTokens: 10263,
    duration: "5 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Health Tracking Dashboard",
    complexity: "Standard Complexity",
    complexityVariant: "secondary" as const,
    inputTokens: 110952,
    outputTokens: 5639,
    duration: "3 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Recommendation Engine",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 4220364,
    outputTokens: 21733,
    duration: "25 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Automated ETL Pipeline",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 2513197,
    outputTokens: 78438,
    duration: "32 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Automated Code Reviewer",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 1707944,
    outputTokens: 79117,
    duration: "29 minutes",
    originalModel: "claude-sonnet-4-6",
  },
  {
    name: "Risk Assessment",
    complexity: "Complex",
    complexityVariant: "destructive" as const,
    inputTokens: 693487,
    outputTokens: 43371,
    duration: "15 minutes",
    originalModel: "claude-sonnet-4-6",
  },
];

export default function ModelPricingClient() {
  const t = useTranslations('pricing.modelPricing');
  const toPoints = (amount: number) => Math.round(amount * 100);
  const formatPoints = (amount: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(
      toPoints(amount),
    );
  const {
    allModels,
    modelsData: modelsResponse,
    isLoading: loading,
  } = useModelSelection();

  const [selectedModelId, setSelectedModelId] = useState<string>(
    "habitat/claude-sonnet-4-6",
  );

  // Filter to only show models that have pricing information available and sort by display name order
  const models = useMemo(() => {
    const filteredModels =
      modelsResponse?.models?.filter((model: Model) => {
        return (
          model.input_cost_per_million_tokens !== null &&
          model.input_cost_per_million_tokens !== undefined &&
          model.output_cost_per_million_tokens !== null &&
          model.output_cost_per_million_tokens !== undefined
        );
      }) || [];

    return filteredModels
      .map((v) => ({
        ...v,
        display_name: allModels.find((m) => m.id === v.id)?.label || v.display_name,
        priority: allModels.find((m) => m.id === v.id)?.priority,
        requiresSubscription: allModels.find((m) => m.id === v.id)?.requiresSubscription,
      }))
      .sort((a, b) => {
        // First by free/premium status (premium first)
        if (a.requiresSubscription !== b.requiresSubscription) {
          return a.requiresSubscription ? -1 : 1;
        }

        // Then by priority (higher first)
        if ((a.priority ?? 0) !== (b.priority ?? 0)) {
          return (b.priority ?? 0) - (a.priority ?? 0);
        }

        // Finally by name (alphabetical)
        return (a.display_name ?? a.id).localeCompare(b.display_name ?? b.id);
      });
  }, [modelsResponse?.models, allModels]);

  // Find the selected model
  const selectedModel = models.find((model) => model.id === selectedModelId);

  // Function to calculate cost based on tokens and model pricing
  const calculateCost = (
    inputTokens: number,
    outputTokens: number,
    model: Model,
  ) => {
    if (
      !model.input_cost_per_million_tokens ||
      !model.output_cost_per_million_tokens
    ) {
      return 0;
    }

    const inputCost =
      (inputTokens / 1_000_000) * model.input_cost_per_million_tokens;
    const outputCost =
      (outputTokens / 1_000_000) * model.output_cost_per_million_tokens;

    return inputCost + outputCost;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
          <p className="text-sm text-muted-foreground">{t('loading', {default: 'Loading pricing data...'})}</p>
        </div>
      </div>
    );
  }

  if (!modelsResponse && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">{t('unavailable.title', {default: 'Pricing Unavailable'})}</h3>
            <p className="text-sm text-muted-foreground">
              {t('unavailable.desc', {default: 'Failed to fetch model pricing. Please refresh the page.'})}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 sm:p-8 max-w-4xl mx-auto max-h-[70vh] overflow-y-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-orange-500" />
            {t('examples.title', {default: 'Usage Examples'})}
          </CardTitle>
          <CardDescription>
            {t('examples.subtitle', {default: 'See estimated points usage across different task types.'})}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t('select.label', {default: 'Select a model to estimate points:'})}
              </label>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder={t('select.placeholder', {default: 'Choose a model'})} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {exampleTasks.map((task, index) => {
                const calculatedCost = selectedModel
                  ? calculateCost(
                      task.inputTokens,
                      task.outputTokens,
                      selectedModel,
                    )
                  : null;

                return (
                  <div
                    key={index}
                    className="p-4 border border-border rounded-lg space-y-3"
                  >
                    <div className="space-y-2">
                      <h4 className="font-semibold text-foreground">
                        {task.name}
                      </h4>
                    </div>
                    <div className="space-y-2 text-sm mt-6">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('examples.model', {default: 'Model'})}:
                        </span>
                        <span>
                          {selectedModel?.display_name || task.originalModel}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('examples.input', {default: 'Input volume'})}:
                        </span>
                        <span>{new Intl.NumberFormat(undefined).format(task.inputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('examples.output', {default: 'Output volume'})}:
                        </span>
                        <span>{new Intl.NumberFormat(undefined).format(task.outputTokens)}</span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-muted-foreground">
                          {t('examples.cost', {default: 'Estimated cost'})}:
                        </span>
                        {calculatedCost !== null ? (
                          <span className="text-brand-600">
                            {formatPoints(calculatedCost)} {t('pointsUnit', { default: 'points' })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t('examples.selectHint', {default: 'Select a model above'})}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('table.title', { default: 'Model pricing' })}</CardTitle>
          <CardDescription>
            {t('table.desc', { default: 'Rates shown in points per 1M input/output units.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-card border border-border rounded-lg">
            <div className="px-6 py-4 border-b border-border">
              <div className="grid grid-cols-3 gap-4 text-sm font-medium text-muted-foreground">
                <div className="col-span-1">{t('table.model', { default: 'Model' })}</div>
                <div className="col-span-1 text-center">{t('table.inputCost', { default: 'Input rate' })}</div>
                <div className="col-span-1 text-center">{t('table.outputCost', { default: 'Output rate' })}</div>
              </div>
            </div>

            <div className="divide-y divide-border">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={`px-6 py-4 hover:bg-muted/50 transition-colors duration-150 ${
                    selectedModelId === model.id
                      ? "bg-brand-50 dark:bg-brand-950/20 border-l-4 border-l-brand-500"
                      : ""
                  }`}
                >
                  <div className="grid grid-cols-3 gap-4 items-center">
                    {/* Model Name */}
                    <div className="col-span-1">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-brand-500 rounded-full flex-shrink-0"></div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {model.display_name ?? model.id}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Input Cost */}
                    <div className="col-span-1 text-center">
                      <div className="space-y-1">
                        {model.input_cost_per_million_tokens !== null &&
                        model.input_cost_per_million_tokens !== undefined ? (
                          <>
                            <div className="font-semibold text-foreground">
                              {formatPoints(model.input_cost_per_million_tokens)} {t('pointsUnit', { default: 'points' })}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t('table.perMillion', { default: 'per 1M units' })}
                            </div>
                          </>
                        ) : (
                          <div className="font-semibold text-muted-foreground">—</div>
                        )}
                      </div>
                    </div>

                    {/* Output Cost */}
                    <div className="col-span-1 text-center">
                      <div className="space-y-1">
                        {model.output_cost_per_million_tokens !== null &&
                        model.output_cost_per_million_tokens !== undefined ? (
                          <>
                            <div className="font-semibold text-foreground">
                              {formatPoints(model.output_cost_per_million_tokens)} {t('pointsUnit', { default: 'points' })}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t('table.perMillion', { default: 'per 1M units' })}
                            </div>
                          </>
                        ) : (
                          <div className="font-semibold text-muted-foreground">—</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
