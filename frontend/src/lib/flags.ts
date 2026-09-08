export const ENABLE_INTEGRATIONS = process.env.NEXT_PUBLIC_ENABLE_INTEGRATIONS === 'true';

// Feature flag: enable the new unified context menu system
export const ENABLE_NEW_CONTEXT_MENU = process.env.NEXT_PUBLIC_NEW_CONTEXT_MENU === 'true';

// Smart Guides v2 is on by default (no env flag)
export const ENABLE_GUIDES_V2 = true;
