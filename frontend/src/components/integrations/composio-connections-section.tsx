'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, XCircle, ExternalLink, Zap } from 'lucide-react';
import { backendApi } from '@/lib/api-client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import React from 'react';

interface AuthConfigInfo {
  auth_config_id: string;
  user_id: string;
  auth_scheme: string;
}

interface ToolkitInfo {
  toolkit: string;
  auth_config_id: string;
  user_id: string;
  auth_scheme: string;
}

export const ComposioConnectionsSection: React.FC = () => {
  const [authConfigs, setAuthConfigs] = useState<AuthConfigInfo[]>([]);
  const [connectedToolkits, setConnectedToolkits] = useState<ToolkitInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAuthConfigs = async () => {
    setLoading(true);
    try {
      const response = await backendApi.get('/composio/auth-configs');
      // Handle both successful responses and 404s
      if (response.success) {
        setAuthConfigs(response.data?.auth_configs || response.data || []);
      } else {
        setAuthConfigs([]);
      }
    } catch (error: any) {
      console.error('Error fetching auth configs:', error);
      setAuthConfigs([]);
      // Show error only for non-404 errors
      if (error?.response?.status !== 404) {
        toast.error('Failed to fetch auth configurations');
      }
    }
    setLoading(false);
  };

  const fetchConnectedToolkits = async () => {
    setLoading(true);
    try {
      const response = await backendApi.get('/composio/connected-toolkits');
      // Handle both successful responses and 404s
      if (response.success) {
        setConnectedToolkits(response.data?.toolkits || response.data || []);
      } else {
        setConnectedToolkits([]);
      }
    } catch (error: any) {
      console.error('Error fetching connected toolkits:', error);
      setConnectedToolkits([]);
      // Show error only for non-404 errors
      if (error?.response?.status !== 404) {
        toast.error('Failed to fetch connected toolkits');
      }
    }
    setLoading(false);
  };

  React.useEffect(() => {
    fetchAuthConfigs();
    fetchConnectedToolkits();
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Composio Integrations
          </CardTitle>
          <CardDescription>
            Manage your external app connections and credentials
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              onClick={fetchAuthConfigs}
              disabled={loading}
              variant="outline"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Refresh Configurations
            </Button>
            <Button
              onClick={fetchConnectedToolkits}
              disabled={loading}
              variant="outline"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Refresh Toolkits
            </Button>
          </div>

          {authConfigs.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Authentication Configurations</h3>
              <div className="grid gap-3">
                {authConfigs.map((config) => (
                  <div key={config.auth_config_id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="font-medium">{config.auth_config_id}</p>
                        <p className="text-sm text-muted-foreground">
                          Auth Scheme: {config.auth_scheme}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">Connected</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {connectedToolkits.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Connected Toolkits</h3>
              <div className="grid gap-3">
                {connectedToolkits.map((toolkit, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="font-medium">{toolkit.toolkit}</p>
                        <p className="text-sm text-muted-foreground">
                          Auth: {toolkit.auth_scheme}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">Active</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {authConfigs.length === 0 && connectedToolkits.length === 0 && !loading && (
            <Alert>
              <AlertDescription>
                No integrations configured yet. Set up your first integration to get started.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};