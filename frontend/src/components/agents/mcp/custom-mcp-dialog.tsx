import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface CustomMCPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: {
    name: string;
    type: 'http' | 'sse';
    config: {
      url: string;
      headers?: Record<string, string>;
    };
    enabledTools: string[];
    selectedProfileId?: string;
  }) => void;
}

export const CustomMCPDialog: React.FC<CustomMCPDialogProps> = ({
  open,
  onOpenChange,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'http' | 'sse'>('http');
  const [headersJson, setHeadersJson] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setUrl('');
      setType('http');
      setHeadersJson('');
      setError(null);
      setIsSaving(false);
    }
  }, [open]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      let headers: Record<string, string> | undefined;
      if (headersJson.trim()) {
        try {
          const parsed = JSON.parse(headersJson);
          if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Headers must be a JSON object');
          }
          headers = parsed;
        } catch (err: any) {
          setError(err.message || 'Invalid headers JSON');
          setIsSaving(false);
          return;
        }
      }

      onSave({
        name: name || (type === 'http' ? 'HTTP MCP' : 'SSE MCP'),
        type,
        config: {
          url,
          headers,
        },
        enabledTools: [],
      });

      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save MCP configuration');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Custom MCP Server</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom MCP"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-url">Server URL</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-mcp-server.com/api"
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={type === 'http' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setType('http')}
              >
                HTTP
              </Button>
              <Button
                type="button"
                variant={type === 'sse' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setType('sse')}
              >
                SSE
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-headers">Headers (optional)</Label>
            <Textarea
              id="mcp-headers"
              value={headersJson}
              onChange={(e) => setHeadersJson(e.target.value)}
              placeholder='{"Authorization": "Bearer ..."}'
              className="font-mono text-xs"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              JSON object of headers to include with each request to the MCP server.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-500">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !url}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

