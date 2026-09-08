import { FileBrowserModal } from '@/components/FileBrowser';
import { AuthProvider } from '@/hooks/useAuth';
import { cleanupAppState, initializeAppState, initializePersistence, queryClient } from '@/stores/query-client';
import { errorLog } from '@/utils/logger';
import { QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect } from 'react';

interface AppProvidersProps {
    children: React.ReactNode;
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
    useEffect(() => {
        // Initialize persistence and app state management
        const initialize = async () => {
            try {
                await initializePersistence();
                initializeAppState();
            } catch (error) {
                errorLog('Failed to initialize app providers:', error);
            }
        };

        initialize();

        // Cleanup on unmount
        return () => {
            cleanupAppState();
        };
    }, []);

    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                {children}
                <FileBrowserModal />
            </AuthProvider>
        </QueryClientProvider>
    );
};
