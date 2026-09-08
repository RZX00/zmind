export const clearInviteTokens = () => {
  if (typeof window === 'undefined') return;

  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('canvas_invite_token:') || key.startsWith('canvas_invite_owner:')) {
        localStorage.removeItem(key);
      }
    });

    try {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('canvas_invite_token:') || key.startsWith('canvas_invite_owner:')) {
          sessionStorage.removeItem(key);
        }
      });
    } catch {}
  } catch (error) {
    console.error('✗ Error clearing invite tokens:', error);
  }
};

export const clearUserLocalStorage = () => {
  if (typeof window === 'undefined') return;

  try {
    // Note: Preserve model preference on logout - user choice should persist
    const fixedKeys = [
      'customModels',
      'auth-tracking-storage',
      'pendingAgentPrompt',
    ];

    const suffixesToClear = [
      'model-selection-v2',
      'model-selection-v3',
      'upgrade_dialog_displayed',
    ];

    fixedKeys.forEach((k) => localStorage.removeItem(k));

    Object.keys(localStorage).forEach((key) => {
      if (suffixesToClear.some((s) => key.endsWith(s))) {
        localStorage.removeItem(key);
      }
    });

    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('maintenance-dismissed-')) {
        localStorage.removeItem(key);
      }
    });

    clearInviteTokens();

    console.log('✓ Local storage cleared on logout');
  } catch (error) {
    console.error('✗ Error clearing local storage:', error);
  }
};
