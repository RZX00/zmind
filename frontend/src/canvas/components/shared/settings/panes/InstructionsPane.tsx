"use client";

import React, { useEffect, useState } from 'react';
import { Brain, Loader2, Save } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { backendApi } from '@/lib/api-client';

const InstructionsPane: React.FC = () => {
  const selectedAgentId = 'Zmind';
  const [instructions, setInstructions] = useState('');
  const [originalInstructions, setOriginalInstructions] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);

  useEffect(() => {
    const loadAgentInstructions = async () => {
      try {
        setIsLoadingData(true);
        const response = await backendApi.get(`/agents/${selectedAgentId}`);
        const systemPrompt = response.data?.system_prompt || '';
        setInstructions(systemPrompt);
        setOriginalInstructions(systemPrompt);
      } catch (error) {
        console.error('Error loading agent instructions:', error);
        toast.error('Failed to load current instructions');
      } finally {
        setIsLoadingData(false);
      }
    };
    if (selectedAgentId) loadAgentInstructions();
  }, [selectedAgentId]);

  const hasChanges = instructions.trim() !== originalInstructions.trim();

  const handleSave = async () => {
    if (!hasChanges) {
      toast.info('No changes to save');
      return;
    }
    setIsLoading(true);
    try {
      await backendApi.put(`/agents/${selectedAgentId}`, {
        system_prompt: instructions.trim(),
      });
      setOriginalInstructions(instructions.trim());
      toast.success('Instructions saved successfully');
    } catch (error: any) {
      console.error('Error saving instructions:', error);
      toast.error(error?.response?.data?.detail || 'Failed to save instructions');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4" />
        <h3 className="font-medium">Instructions</h3>
      </div>
      {isLoadingData ? (
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading current instructions...
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">System Instructions</label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Enter your custom instructions..."
              className="min-h-[180px]"
            />
            <p className="text-xs text-muted-foreground">
              These instructions affect AI behavior across conversations.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {hasChanges ? (
                <span className="text-orange-600 dark:text-orange-400">You have unsaved changes</span>
              ) : (
                <span className="text-green-700 dark:text-green-400">All changes saved</span>
              )}
            </div>
            <div className="flex gap-2">
              {hasChanges && (
                <Button variant="outline" onClick={() => setInstructions(originalInstructions)} disabled={isLoading}>
                  Reset
                </Button>
              )}
              <Button onClick={handleSave} disabled={isLoading || !hasChanges}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" /> Save Instructions
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default InstructionsPane;

