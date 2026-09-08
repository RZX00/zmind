/**
 * Skills Marketplace Page
 *
 * Allows users to import, manage, and configure Claude Code skills.
 */

import { SkillsMarketplacePage } from '@/components/skills-marketplace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function SkillsMarketplacePageRoute() {
  return <SkillsMarketplacePage />;
}
