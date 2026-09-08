import React from 'react';
import {
  Check,
  Square,
  ArrowUp,
  RefreshCw,
  FileText,
  Play,
  ExternalLink,
  CornerUpRight,
  ChevronDown,
  ChevronUp,
  Image as LucideImage,
  Code,
  Camera,
} from 'lucide-react';

type IconSize = number | string;

export type IconProps = React.ComponentProps<'svg'> & {
  size?: IconSize;
  strokeWidth?: number | string;
};

// Generic safe fallback icon to prevent runtime errors
const FallbackIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const { size, strokeWidth, ...rest } = props as IconProps;
  const width = size ?? (rest as any).width ?? '1em';
  const height = size ?? (rest as any).height ?? '1em';
  const sw = (strokeWidth as number | undefined) ?? 2;
  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M7 7l10 10M17 7L7 17"/>
    </svg>
  );
});
FallbackIcon.displayName = 'FallbackIcon';

// Direct Lucide icon exports
export const CheckIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <Check ref={ref} {...props} />;
});
CheckIcon.displayName = 'CheckIcon';

export const SquareIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <Square ref={ref} {...props} />;
});
SquareIcon.displayName = 'SquareIcon';

export const ArrowUpIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <ArrowUp ref={ref} {...props} />;
});
ArrowUpIcon.displayName = 'ArrowUpIcon';

// Loader2 using RefreshCw for better loading animation
export const Loader2 = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <RefreshCw ref={ref} {...props} />;
});
Loader2.displayName = 'Loader2';

export const FileTextIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <FileText ref={ref} {...props} />;
});
FileTextIcon.displayName = 'FileTextIcon';

export const PlayIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <Play ref={ref} {...props} />;
});
PlayIcon.displayName = 'PlayIcon';

export const ExternalLinkIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <ExternalLink ref={ref} {...props} />;
});
ExternalLinkIcon.displayName = 'ExternalLinkIcon';

export const CornerUpRightIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <CornerUpRight ref={ref} {...props} />;
});
CornerUpRightIcon.displayName = 'CornerUpRightIcon';

export const ChevronDownIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <ChevronDown ref={ref} {...props} />;
});
ChevronDownIcon.displayName = 'ChevronDownIcon';

export const ChevronUpIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <ChevronUp ref={ref} {...props} />;
});
ChevronUpIcon.displayName = 'ChevronUpIcon';

export const ImageIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <LucideImage ref={ref} {...props} />;
});
ImageIcon.displayName = 'ImageIcon';

export const Code2Icon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <Code ref={ref} {...props} />;
});
Code2Icon.displayName = 'Code2Icon';

export const CameraIcon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  return <Camera ref={ref} {...props} />;
});
CameraIcon.displayName = 'CameraIcon';

// Legacy exports for backward compatibility
export { Check as Check };
export { Square };
export { ArrowUp };
export { FileText };
export { Play };
export { ExternalLink };
export { CornerUpRight };
export { ChevronDown };
export { ChevronUp };
export { LucideImage as Image };
export { Code as Code2 };
export { Camera };
