import { useCanvasStore } from '@/canvas/stores/canvas.store';

/** 画布 CSS scale；把手拖拽的屏幕位移要除以它才是逻辑像素。 */
export function readCanvasScale(): number {
  const scale = useCanvasStore.getState().viewState?.transform?.scale;
  return typeof scale === 'number' && scale > 0 ? scale : 1;
}
