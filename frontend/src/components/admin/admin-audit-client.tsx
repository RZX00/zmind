'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { JsonViewer } from '@/components/thread/tool-views/shared/JsonViewer';
import { Copy, Check, RefreshCcw, AlertTriangle } from 'lucide-react';
import {
  AuditEvent,
  ProjectionFailure,
  useAdminAuditEvents,
  useAdminProjectionFailures,
} from '@/hooks/react-query/admin/use-admin-audit';

const toIsoString = (value: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const shortId = (value?: string | null) => {
  if (!value) return 'N/A';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
};

const normalizeValue = (value?: string | null) => {
  if (!value) return 'N/A';
  return value;
};

export default function AdminAuditClient() {
  const t = useTranslations();
  const fmt = useFormatter();

  const [activeTab, setActiveTab] = useState('events');

  const [eventPage, setEventPage] = useState(1);
  const [failurePage, setFailurePage] = useState(1);
  const pageSize = 20;

  const [eventFilters, setEventFilters] = useState({
    eventType: '',
    aggregateId: '',
    tenantId: '',
    actorId: '',
    since: '',
    until: '',
  });
  const [failureFilters, setFailureFilters] = useState({
    projectionName: '',
    eventType: '',
    tenantId: '',
    since: '',
    until: '',
  });
  const [debouncedEventFilters, setDebouncedEventFilters] = useState(eventFilters);
  const [debouncedFailureFilters, setDebouncedFailureFilters] = useState(failureFilters);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [selectedFailure, setSelectedFailure] = useState<ProjectionFailure | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEventFilters(eventFilters);
      setEventPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [eventFilters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFailureFilters(failureFilters);
      setFailurePage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [failureFilters]);

  const eventQuery = useMemo(
    () => ({
      page: eventPage,
      page_size: pageSize,
      event_type: debouncedEventFilters.eventType || undefined,
      aggregate_id: debouncedEventFilters.aggregateId || undefined,
      tenant_id: debouncedEventFilters.tenantId || undefined,
      actor_id: debouncedEventFilters.actorId || undefined,
      since: toIsoString(debouncedEventFilters.since),
      until: toIsoString(debouncedEventFilters.until),
    }),
    [debouncedEventFilters, eventPage],
  );

  const failureQuery = useMemo(
    () => ({
      page: failurePage,
      page_size: pageSize,
      projection_name: debouncedFailureFilters.projectionName || undefined,
      event_type: debouncedFailureFilters.eventType || undefined,
      tenant_id: debouncedFailureFilters.tenantId || undefined,
      since: toIsoString(debouncedFailureFilters.since),
      until: toIsoString(debouncedFailureFilters.until),
    }),
    [debouncedFailureFilters, failurePage],
  );

  const {
    data: eventData,
    isLoading: isLoadingEvents,
    error: eventError,
    refetch: refetchEvents,
  } = useAdminAuditEvents(eventQuery);

  const {
    data: failureData,
    isLoading: isLoadingFailures,
    error: failureError,
    refetch: refetchFailures,
  } = useAdminProjectionFailures(failureQuery);

  const formatDateTime = useCallback(
    (value: string) =>
      fmt.dateTime(new Date(value), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [fmt],
  );

  const handleCopy = async (value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 2000);
    } catch (err) {
      console.error('Failed to copy value', err);
    }
  };

  const handleOpenEvent = (event: AuditEvent) => {
    setSelectedEvent(event);
    setSelectedFailure(null);
    setDetailsOpen(true);
  };

  const handleOpenFailure = (failure: ProjectionFailure) => {
    setSelectedFailure(failure);
    setSelectedEvent(null);
    setDetailsOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsOpen(false);
    setSelectedEvent(null);
    setSelectedFailure(null);
    setCopiedValue(null);
  };

  const resetEventFilters = () => {
    const next = {
      eventType: '',
      aggregateId: '',
      tenantId: '',
      actorId: '',
      since: '',
      until: '',
    };
    setEventFilters(next);
    setDebouncedEventFilters(next);
    setEventPage(1);
  };

  const resetFailureFilters = () => {
    const next = {
      projectionName: '',
      eventType: '',
      tenantId: '',
      since: '',
      until: '',
    };
    setFailureFilters(next);
    setDebouncedFailureFilters(next);
    setFailurePage(1);
  };

  const handleRefresh = () => {
    if (activeTab === 'events') {
      refetchEvents();
    } else {
      refetchFailures();
    }
  };

  const handleClearFilters = () => {
    if (activeTab === 'events') {
      resetEventFilters();
    } else {
      resetFailureFilters();
    }
  };

  const eventColumns: DataTableColumn<AuditEvent>[] = useMemo(
    () => [
      {
        id: 'event',
        header: t('admin.audit.events.columns.event', { default: 'Event' }),
        cell: (item) => (
          <div className="flex flex-col gap-1 min-w-[200px]">
            <span className="font-medium text-foreground">{item.event_type}</span>
            <span className="text-xs text-muted-foreground">
              v{item.schema_version} · {shortId(item.event_id)}
            </span>
          </div>
        ),
      },
      {
        id: 'aggregate',
        header: t('admin.audit.events.columns.aggregate', { default: 'Object' }),
        cell: (item) => (
          <div className="flex flex-col gap-1 min-w-[200px]">
            <Badge variant="outline" className="w-fit">
              {item.aggregate_type}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">
              {shortId(item.aggregate_id)}
            </span>
          </div>
        ),
      },
      {
        id: 'tenant',
        header: t('admin.audit.events.columns.tenant', { default: 'Workspace' }),
        cell: (item) => (
          <span className="text-xs font-mono text-muted-foreground">
            {shortId(item.tenant_id)}
          </span>
        ),
        width: 'w-40',
      },
      {
        id: 'actor',
        header: t('admin.audit.events.columns.actor', { default: 'User' }),
        cell: (item) => (
          <span className="text-xs font-mono text-muted-foreground">
            {shortId(item.actor_id)}
          </span>
        ),
        width: 'w-40',
      },
      {
        id: 'occurred',
        header: t('admin.audit.events.columns.occurred', { default: 'Occurred' }),
        cell: (item) => (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(item.occurred_at)}
          </span>
        ),
        width: 'w-40',
      },
    ],
    [formatDateTime, t],
  );

  const failureColumns: DataTableColumn<ProjectionFailure>[] = useMemo(
    () => [
      {
        id: 'projection',
        header: t('admin.audit.failures.columns.projection', { default: 'View' }),
        cell: (item) => (
          <Badge variant="outline" className="w-fit">
            {item.projection_name}
          </Badge>
        ),
      },
      {
        id: 'event',
        header: t('admin.audit.failures.columns.event', { default: 'Event' }),
        cell: (item) => (
          <div className="flex flex-col gap-1 min-w-[200px]">
            <span className="font-medium text-foreground">{item.event_type}</span>
            <span className="text-xs text-muted-foreground">
              v{item.schema_version} · {shortId(item.event_id)}
            </span>
          </div>
        ),
      },
      {
        id: 'aggregate',
        header: t('admin.audit.failures.columns.aggregate', { default: 'Object' }),
        cell: (item) => (
          <div className="flex flex-col gap-1 min-w-[200px]">
            <span className="text-xs text-muted-foreground">{item.aggregate_type}</span>
            <span className="text-xs font-mono text-muted-foreground">
              {shortId(item.aggregate_id)}
            </span>
          </div>
        ),
      },
      {
        id: 'failures',
        header: t('admin.audit.failures.columns.failures', { default: 'Failures' }),
        cell: (item) => (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{item.failure_count}</span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(item.last_failed_at)}
            </span>
          </div>
        ),
        width: 'w-40',
      },
      {
        id: 'error',
        header: t('admin.audit.failures.columns.error', { default: 'Last error' }),
        cell: (item) => (
          <span className="text-xs text-muted-foreground max-w-[260px] truncate block">
            {item.last_error || 'N/A'}
          </span>
        ),
      },
    ],
    [formatDateTime, t],
  );

  const renderLoadingRows = () => (
    <div className="p-6 space-y-3">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );

  const DetailRow = ({
    label,
    value,
    mono,
    copyable,
  }: {
    label: string;
    value?: string | null;
    mono?: boolean;
    copyable?: boolean;
  }) => {
    const displayValue = normalizeValue(value);
    const showCopy = copyable && value;
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>{displayValue}</p>
        </div>
        {showCopy ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy(value);
            }}
            title={t('common.copy', { default: 'Copy' })}
          >
            {copiedValue === value ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        ) : null}
      </div>
    );
  };

  const renderEventDetails = (event: AuditEvent) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetailRow label="Event type" value={event.event_type} />
        <DetailRow label="Schema version" value={`v${event.schema_version}`} />
        <DetailRow label="Event ID" value={event.event_id} mono copyable />
        <DetailRow label="Aggregate type" value={event.aggregate_type} />
        <DetailRow label="Aggregate ID" value={event.aggregate_id} mono copyable />
        <DetailRow label="Workspace ID" value={event.tenant_id} mono copyable />
        <DetailRow label="User ID" value={event.actor_id} mono copyable />
        <DetailRow label="Occurred at" value={formatDateTime(event.occurred_at)} />
        <DetailRow label="Ingested at" value={formatDateTime(event.ingested_at)} />
      </div>
      <JsonViewer data={event.payload} title="Payload" />
    </div>
  );

  const renderFailureDetails = (failure: ProjectionFailure) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetailRow label="View name" value={failure.projection_name} />
        <DetailRow label="Event type" value={failure.event_type} />
        <DetailRow label="Schema version" value={`v${failure.schema_version}`} />
        <DetailRow label="Event ID" value={failure.event_id} mono copyable />
        <DetailRow label="Aggregate type" value={failure.aggregate_type} />
        <DetailRow label="Aggregate ID" value={failure.aggregate_id} mono copyable />
        <DetailRow label="Workspace ID" value={failure.tenant_id} mono copyable />
        <DetailRow label="User ID" value={failure.actor_id} mono copyable />
        <DetailRow label="Failure count" value={String(failure.failure_count)} />
        <DetailRow label="First failed at" value={formatDateTime(failure.first_failed_at)} />
        <DetailRow label="Last failed at" value={formatDateTime(failure.last_failed_at)} />
      </div>

      {failure.last_error ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Last error</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs break-words">{failure.last_error}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <JsonViewer data={failure.payload} title="Payload" />
    </div>
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-container-wide space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight dashboard-title">
              Audit & Events - Admin
            </h1>
            <p className="text-md text-muted-foreground mt-2">
              Trace domain events and projection failures with full payload details.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRefresh} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              {t('common.refresh', { default: 'Refresh' })}
            </Button>
            <Button variant="ghost" onClick={handleClearFilters} className="gap-2">
              {t('common.clearFilters', { default: 'Clear filters' })}
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="failures">Projection failures</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="space-y-4">
            <Card className="border">
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle>Event filters</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {eventData?.pagination?.total_items ?? 0} results
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Local time
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Event name</Label>
                    <Input
                      value={eventFilters.eventType}
                      onChange={(e) =>
                        setEventFilters((prev) => ({ ...prev, eventType: e.target.value }))
                      }
                      placeholder="AgentRunCompleted"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Object ID</Label>
                    <Input
                      value={eventFilters.aggregateId}
                      onChange={(e) =>
                        setEventFilters((prev) => ({ ...prev, aggregateId: e.target.value }))
                      }
                      placeholder="canvas_id / account_id"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Workspace ID</Label>
                    <Input
                      value={eventFilters.tenantId}
                      onChange={(e) =>
                        setEventFilters((prev) => ({ ...prev, tenantId: e.target.value }))
                      }
                      placeholder="workspace_id"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">User ID</Label>
                    <Input
                      value={eventFilters.actorId}
                      onChange={(e) =>
                        setEventFilters((prev) => ({ ...prev, actorId: e.target.value }))
                      }
                      placeholder="user_id"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Input
                      type="datetime-local"
                      value={eventFilters.since}
                      onChange={(e) =>
                        setEventFilters((prev) => ({ ...prev, since: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Input
                      type="datetime-local"
                      value={eventFilters.until}
                      onChange={(e) =>
                        setEventFilters((prev) => ({ ...prev, until: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0">
                {eventError ? (
                  <div className="border rounded-md p-6 text-destructive">
                    Failed to load events: {eventError.message}
                  </div>
                ) : isLoadingEvents ? (
                  renderLoadingRows()
                ) : (
                  <DataTable
                    columns={eventColumns}
                    data={eventData?.data || []}
                    onRowClick={handleOpenEvent}
                    emptyMessage="No events found for this filter."
                    getItemId={(item) => item.event_id}
                  />
                )}
              </CardContent>
            </Card>

            {eventData?.pagination && (
              <Pagination
                currentPage={eventData.pagination.current_page}
                totalPages={eventData.pagination.total_pages}
                onPageChange={setEventPage}
              />
            )}
          </TabsContent>

          <TabsContent value="failures" className="space-y-4">
            <Card className="border">
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle>Failure filters</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {failureData?.pagination?.total_items ?? 0} results
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Local time
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">View name</Label>
                    <Input
                      value={failureFilters.projectionName}
                      onChange={(e) =>
                        setFailureFilters((prev) => ({ ...prev, projectionName: e.target.value }))
                      }
                      placeholder="canvas_search_projection"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Event name</Label>
                    <Input
                      value={failureFilters.eventType}
                      onChange={(e) =>
                        setFailureFilters((prev) => ({ ...prev, eventType: e.target.value }))
                      }
                      placeholder="CanvasDeleted"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Workspace ID</Label>
                    <Input
                      value={failureFilters.tenantId}
                      onChange={(e) =>
                        setFailureFilters((prev) => ({ ...prev, tenantId: e.target.value }))
                      }
                      placeholder="workspace_id"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Input
                      type="datetime-local"
                      value={failureFilters.since}
                      onChange={(e) =>
                        setFailureFilters((prev) => ({ ...prev, since: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Input
                      type="datetime-local"
                      value={failureFilters.until}
                      onChange={(e) =>
                        setFailureFilters((prev) => ({ ...prev, until: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0">
                {failureError ? (
                  <div className="border rounded-md p-6 text-destructive">
                    Failed to load failures: {failureError.message}
                  </div>
                ) : isLoadingFailures ? (
                  renderLoadingRows()
                ) : (
                  <DataTable
                    columns={failureColumns}
                    data={failureData?.data || []}
                    onRowClick={handleOpenFailure}
                    emptyMessage="No failures found for this filter."
                    getItemId={(item) => `${item.projection_name}-${item.event_id}`}
                  />
                )}
              </CardContent>
            </Card>

            {failureData?.pagination && (
              <Pagination
                currentPage={failureData.pagination.current_page}
                totalPages={failureData.pagination.total_pages}
                onPageChange={setFailurePage}
              />
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={detailsOpen} onOpenChange={(open) => !open && handleCloseDetails()}>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>
                {selectedEvent ? 'Event details' : 'Failure details'}
              </DialogTitle>
              <DialogDescription>
                {selectedEvent
                  ? 'Full event payload and metadata for auditing.'
                  : 'Projection failure history and error payload.'}
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="flex-1 pr-4">
              {selectedEvent ? renderEventDetails(selectedEvent) : null}
              {selectedFailure ? renderFailureDetails(selectedFailure) : null}
            </ScrollArea>

            <DialogFooter className="flex-shrink-0">
              <Button variant="outline" onClick={handleCloseDetails}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
