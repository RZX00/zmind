import { useCanvasStore } from '../stores/canvas.store';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  DEFAULT_TEXT_OPACITY_PRESET,
  getTextLayoutPreset,
  getTextOpacityPreset
} from '../constants/textNodePresets';

export const useTextLayoutPreset = () => {
  const presetId = useCanvasStore(
    (state) => state.canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET
  );
  return getTextLayoutPreset(presetId);
};

export const useTextOpacityPreset = () => {
  const presetId = useCanvasStore(
    (state) => state.canvas?.textOpacityPreset ?? DEFAULT_TEXT_OPACITY_PRESET
  );
  return getTextOpacityPreset(presetId);
};
