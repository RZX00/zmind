import React from 'react';
import {
  CheckSquare,
  Circle,
  Code2,
  Diamond,
  FileBox,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Layers,
  Image as ImageIcon,
  LayoutPanelLeft,
  LayoutPanelTop,
  Link2,
  Music2,
  Presentation,
  Square,
  Table,
  Video,
} from 'lucide-react';
import type { CanvasIconName } from '../../../constants/canvasIcons';

const ICON_MAP: Record<CanvasIconName, React.ComponentType<any>> = {
  text: FileText,
  todo: CheckSquare,
  code: Code2,
  column: LayoutPanelLeft,
  table: Table,
  canvasLink: Link2,
  group: Layers,
  media: FileBox,
  image: ImageIcon,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  audio: Music2,
  video: Video,
  shapeSquare: Square,
  shapeCircle: Circle,
  shapeDiamond: Diamond,
  tableMinimal: LayoutPanelTop,
  tableStriped: LayoutPanelLeft,
  tableGrid: Table,
};

export interface CanvasIconProps extends React.SVGProps<SVGSVGElement> {
  name: CanvasIconName;
  size?: number;
  strokeWidth?: number;
}

export const CanvasIcon = React.forwardRef<SVGSVGElement, CanvasIconProps>(
  ({ name, size = 16, strokeWidth = 1.75, className, ...rest }, ref) => {
    const IconComponent = ICON_MAP[name] || FileText;
    return (
      <IconComponent
        ref={ref}
        size={size}
        strokeWidth={strokeWidth}
        className={className}
        {...rest}
      />
    );
  }
);
CanvasIcon.displayName = 'CanvasIcon';
