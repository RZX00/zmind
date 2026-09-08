import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Brain,
  BarChart3,
  FileOutput,
  Image as ImageIcon,
  Zap,
  Globe,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Star,
  Copy,
  ExternalLink,
  Clock,
  Info,
  Download,
  Share,
  Filter,
  Search,
  RefreshCw,
} from 'lucide-react';

export interface IntelligentResultData {
  type: 'search' | 'analytics' | 'document' | 'image';
  title: string;
  subtitle?: string;
  status: 'success' | 'warning' | 'error' | 'processing';
  timestamp: string;
  processingTime?: string;

  // Metrics
  metrics?: {
    accuracy?: number;
    confidence?: number;
    relevance?: number;
    coverage?: number;
    quality?: number;
    speed?: string;
    count?: number;
    size?: number;
  };

  // Main content sections
  sections: IntelligentResultSection[];

  // Optional metadata
  metadata?: {
    source?: string;
    version?: string;
    modelUsed?: string;
    tokens?: number;
    cost?: number;
    [key: string]: any;
  };

  // Actions available for this result
  actions?: IntelligentResultAction[];
}

export interface IntelligentResultSection {
  id: string;
  title: string;
  type: 'text' | 'list' | 'table' | 'chart' | 'image' | 'code' | 'json' | 'metrics';
  content: any;
  description?: string;
  icon?: React.ReactNode;
  badge?: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface IntelligentResultAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  type: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
}

interface IntelligentResultDisplayProps {
  data: IntelligentResultData;
  isStreaming?: boolean;
  onActionClick?: (actionId: string) => void;
  className?: string;
}

/**
 * Intelligent Result Display System
 *
 * A unified system for displaying results from cloud service tools.
 * Provides adaptive layouts, interactive components, and consistent styling.
 */
export function IntelligentResultDisplay({
  data,
  isStreaming = false,
  onActionClick,
  className = ''
}: IntelligentResultDisplayProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [copied, setCopied] = useState<string | null>(null);

  // Get appropriate styling based on result type and status
  const getStatusColor = () => {
    switch (data.status) {
      case 'success': return 'green';
      case 'warning': return 'yellow';
      case 'error': return 'red';
      case 'processing': return 'blue';
      default: return 'gray';
    }
  };

  const getTypeIcon = () => {
    switch (data.type) {
      case 'search': return <Brain className="h-4 w-4" />;
      case 'analytics': return <BarChart3 className="h-4 w-4" />;
      case 'document': return <FileOutput className="h-4 w-4" />;
      case 'image': return <ImageIcon className="h-4 w-4" />;
      default: return <Zap className="h-4 w-4" />;
    }
  };

  const getTypeLabel = () => {
    switch (data.type) {
      case 'search': return 'Intelligent Search';
      case 'analytics': return 'Data Analytics';
      case 'document': return 'Document Service';
      case 'image': return 'Image Analysis';
      default: return 'Cloud Service';
    }
  };

  // Handle copy actions
  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Organize sections by priority
  const prioritizedSections = data.sections.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority || 'medium'] - priorityOrder[b.priority || 'medium'];
  });

  const highPrioritySections = prioritizedSections.filter(s => s.priority === 'high');
  const otherSections = prioritizedSections.filter(s => s.priority !== 'high');

  // Render section content based on type
  const renderSectionContent = (section: IntelligentResultSection) => {
    switch (section.type) {
      case 'text':
        return (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {typeof section.content === 'string' ? (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {section.content}
              </p>
            ) : (
              section.content
            )}
          </div>
        );

      case 'list':
        return (
          <ul className="space-y-2">
            {Array.isArray(section.content) && section.content.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-2 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">{item}</span>
              </li>
            ))}
          </ul>
        );

      case 'table':
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {section.content.headers?.map((header: string, index: number) => (
                    <th key={index} className="text-left py-2 px-3 font-medium text-gray-900 dark:text-gray-100">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.content.rows?.map((row: any[], rowIndex: number) => (
                  <tr key={rowIndex} className="border-b border-gray-100 dark:border-gray-800">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="py-2 px-3 text-gray-700 dark:text-gray-300">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'metrics':
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(section.content).map(([key, value]) => (
              <div key={key} className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {typeof value === 'number' ? value.toFixed(1) : String(value)}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                  {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                </div>
              </div>
            ))}
          </div>
        );

      case 'code':
        return (
          <div className="relative">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
              <code>{section.content}</code>
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 h-8 w-8 p-0"
              onClick={() => handleCopy(section.content, section.id)}
            >
              {copied === section.id ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        );

      case 'json':
        return (
          <div className="relative">
            <pre className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-sm">
              <code>{JSON.stringify(section.content, null, 2)}</code>
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 h-8 w-8 p-0"
              onClick={() => handleCopy(JSON.stringify(section.content, null, 2), section.id)}
            >
              {copied === section.id ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        );

      case 'image':
        return (
          <div className="space-y-3">
            {Array.isArray(section.content) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {section.content.map((img, index) => (
                  <div key={index} className="relative group">
                    <Image
                      src={img.url || img}
                      alt={img.alt || `Image ${index + 1}`}
                      width={1200}
                      height={800}
                      unoptimized
                      loader={({ src }) => src}
                      className="w-full h-48 object-cover rounded-lg"
                      sizes="100vw"
                    />
                    {img.caption && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {img.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Image
                src={section.content.url || section.content}
                alt={section.content.alt || section.title}
                width={1200}
                height={800}
                unoptimized
                loader={({ src }) => src}
                className="w-full max-w-md rounded-lg"
                sizes="100vw"
              />
            )}
          </div>
        );

      default:
        return (
          <div className="text-sm text-gray-700 dark:text-gray-300">
            {JSON.stringify(section.content)}
          </div>
        );
    }
  };

  const statusColor = getStatusColor();

  if (isStreaming) {
    return (
      <Card className={`w-full border-brand-200 bg-brand-50/30 ${className}`}>
        <CardContent className="p-6 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-gray-600">Processing intelligent results...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`w-full border-${statusColor}-200 bg-${statusColor}-50/30 ${className}`}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 bg-${statusColor}-100 rounded-lg`}>
              {getTypeIcon()}
            </div>
            <div>
              <CardTitle className={`text-sm font-medium text-${statusColor}-800`}>
                {data.title}
              </CardTitle>
              {data.subtitle && (
                <p className={`text-xs text-${statusColor}-600 mt-0.5`}>
                  {data.subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={`bg-${statusColor}-100 text-${statusColor}-700 text-xs`}>
              <Globe className="h-3 w-3 mr-1" />
              {getTypeLabel()}
            </Badge>
            {data.status === 'success' && (
              <Badge variant="default" className="bg-green-100 text-green-700 text-xs">
                <CheckCircle className="h-3 w-3 mr-1" />
                Complete
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Performance Metrics */}
        {data.metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.metrics.speed && (
              <div className="text-center p-2 bg-white rounded border border-brand-100">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Zap className="h-3 w-3 text-brand-500" />
                  <span className="text-xs font-medium text-gray-600">Speed</span>
                </div>
                <p className="text-lg font-bold text-brand-600">{data.metrics.speed}</p>
              </div>
            )}
            {data.metrics.accuracy && (
              <div className="text-center p-2 bg-white rounded border border-green-100">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Star className="h-3 w-3 text-green-500" />
                  <span className="text-xs font-medium text-gray-600">Accuracy</span>
                </div>
                <p className="text-lg font-bold text-green-600">{data.metrics.accuracy}%</p>
              </div>
            )}
            {data.metrics.confidence && (
              <div className="text-center p-2 bg-white rounded border border-purple-100">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TrendingUp className="h-3 w-3 text-purple-500" />
                  <span className="text-xs font-medium text-gray-600">Confidence</span>
                </div>
                <p className="text-lg font-bold text-purple-600">{data.metrics.confidence}%</p>
              </div>
            )}
            {data.metrics.count && (
              <div className="text-center p-2 bg-white rounded border border-orange-100">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Globe className="h-3 w-3 text-orange-500" />
                  <span className="text-xs font-medium text-gray-600">Results</span>
                </div>
                <p className="text-lg font-bold text-orange-600">
                  {data.metrics.count > 1000 ? `${(data.metrics.count / 1000).toFixed(1)}k` : data.metrics.count}
                </p>
              </div>
            )}
          </div>
        )}

        {/* High Priority Sections (shown prominently) */}
        {highPrioritySections.length > 0 && (
          <div className="space-y-3">
            {highPrioritySections.map((section) => (
              <div key={section.id} className="p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {section.icon}
                    <h4 className="text-sm font-medium text-gray-700">{section.title}</h4>
                    {section.badge && (
                      <Badge variant="outline" className="text-xs">
                        {section.badge}
                      </Badge>
                    )}
                  </div>
                </div>
                {section.description && (
                  <p className="text-xs text-gray-600 mb-3">{section.description}</p>
                )}
                {renderSectionContent(section)}
              </div>
            ))}
          </div>
        )}

        {/* Tabbed Content for Other Sections */}
        {otherSections.length > 0 && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="metadata">Info</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3">
              <ScrollArea className="h-80">
                <div className="space-y-3 pr-4">
                  {otherSections.slice(0, 3).map((section) => (
                    <div key={section.id} className="p-3 bg-white rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        {section.icon}
                        <h4 className="text-sm font-medium text-gray-700">{section.title}</h4>
                      </div>
                      {renderSectionContent(section)}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="details" className="space-y-3">
              <ScrollArea className="h-80">
                <div className="space-y-3 pr-4">
                  {otherSections.map((section) => (
                    <div key={section.id} className="p-3 bg-white rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        {section.icon}
                        <h4 className="text-sm font-medium text-gray-700">{section.title}</h4>
                      </div>
                      {section.description && (
                        <p className="text-xs text-gray-600 mb-2">{section.description}</p>
                      )}
                      {renderSectionContent(section)}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="metadata" className="space-y-3">
              <div className="p-3 bg-white rounded-lg border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Processing Information</h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="font-medium text-gray-600">Timestamp:</span>
                    <br />
                    <span className="text-gray-500">{new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(data.timestamp))}</span>
                  </div>
                  {data.processingTime && (
                    <div>
                      <span className="font-medium text-gray-600">Processing Time:</span>
                      <br />
                      <span className="text-gray-500">{data.processingTime}</span>
                    </div>
                  )}
                  {data.metadata?.modelUsed && (
                    <div>
                      <span className="font-medium text-gray-600">Model:</span>
                      <br />
                      <span className="text-gray-500">{data.metadata.modelUsed}</span>
                    </div>
                  )}
                  {data.metadata?.tokens && (
                    <div>
                      <span className="font-medium text-gray-600">Tokens Used:</span>
                      <br />
                      <span className="text-gray-500">{new Intl.NumberFormat(undefined).format(data.metadata.tokens)}</span>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Action Buttons */}
        {data.actions && data.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
            {data.actions.map((action) => (
              <Button
                key={action.id}
                variant={action.type === 'primary' ? 'default' : action.type === 'danger' ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => {
                  action.onClick();
                  onActionClick?.(action.id);
                }}
                disabled={action.disabled}
                title={action.tooltip}
                className="text-xs"
              >
                {action.icon}
                <span className="ml-1">{action.label}</span>
              </Button>
            ))}
          </div>
        )}

        {/* Cloud Enhancement Notice */}
        <div className="p-3 bg-gradient-to-r from-brand-50 to-green-50 rounded-lg border border-brand-200">
          <h4 className="text-sm font-medium text-gray-800 mb-2">🚀 Intelligent Cloud Processing</h4>
          <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
            <div>
              <span className="font-medium">Performance:</span> Enhanced with AI
            </div>
            <div>
              <span className="font-medium">Accuracy:</span> Machine learning optimized
            </div>
            <div>
              <span className="font-medium">Speed:</span> Cloud-accelerated processing
            </div>
            <div>
              <span className="font-medium">Reliability:</span> 99.9% uptime guarantee
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
