import type { GuideOptions } from '../../domain/guides';
import { useSettingsStore } from '../../canvas/stores/settings.store';

export function getGuideOptions(
  modifierDisabled: boolean,
  overrides: Partial<GuideOptions> = {}
): GuideOptions {
  const guides = useSettingsStore.getState().guides;
  const base: GuideOptions = {
    enabled: guides?.enabled !== false,
    showLines: guides?.showLines === true,
    showDistance: guides?.showDistance === true,
    showSecondaryGuides: guides?.showSecondaryGuides !== false,
    equalSpacing: guides?.equalSpacing !== false,
    tolerancePx: typeof guides?.tolerancePx === 'number' ? guides!.tolerancePx : 8,
    fallbackToGrid: !!guides?.fallbackToGrid,
    gridSizePx: 20,
    modifierDisabled,
    allowBaseline: guides?.allowBaseline !== false,
    allowContainer: guides?.allowContainer !== false,
  };
  return { ...base, ...overrides, modifierDisabled };
}
