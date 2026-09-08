import React from 'react';
import { sanitizeForDisplay } from './sanitizer';
import { cn } from '@/lib/utils';
import { StreamdownMarkdown } from '@/components/thread/StreamdownMarkdown';

export type ToolExecution = {
  function_name?: string;
  xml_tag_name?: string;
  arguments?: any;
  result?: {
    success?: boolean;
    output?: any;
    error?: any;
  };
  execution_details?: any;
  display_name?: string;
};

export type InlineSummary = {
  label: string; // Display name (e.g., Tasks, Web Search)
  line?: string; // One-line summary
  details?: React.ReactNode; // Structured details for expanded view
};

function toTitleCase(s: string): string {
  return s
    .replace(/[\-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeKey(exec: ToolExecution): string {
  const key = exec.xml_tag_name || exec.function_name || 'unknown';
  return key.replace(/_/g, '-').toLowerCase();
}

function formatDisplayName(raw: string | undefined | null): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  return value
    .replace(/[\-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getSubagentDisplayName(exec: ToolExecution, key: string): string | null {
  if (exec.display_name) {
    return formatDisplayName(exec.display_name) || exec.display_name;
  }
  const out = exec.result?.output;
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    const outputDisplay = formatDisplayName((out as any).display_name);
    if (outputDisplay) return outputDisplay;
    const agent = (out as any).agent;
    const fromResult = formatDisplayName(agent);
    if (fromResult) return fromResult;
  }
  const fromArgs = formatDisplayName(exec.arguments?.agent);
  if (fromArgs) return fromArgs;
  if (key.startsWith('transfer-to-')) {
    const suffix = key.replace('transfer-to-', '').trim();
    const fromKey = formatDisplayName(suffix);
    if (fromKey) return fromKey;
  }
  return null;
}

function extractSubagentContent(exec: ToolExecution): string | null {
  const output = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const candidates = [
    output?.content,
    output?.text,
    output?.output?.content,
    output?.output?.text,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  const messages = Array.isArray(output?.messages)
    ? output.messages
    : Array.isArray(output?.output?.messages)
      ? output.output.messages
      : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;
    const content = msg.content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const joined = content.map((item: any) => String(item || '')).join('');
      if (joined.trim()) return joined.trim();
    }
  }
  return null;
}

const SubagentOutput: React.FC<{ content: string }> = ({ content }) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [showFade, setShowFade] = React.useState(false);

  const updateFade = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollHeight - el.clientHeight > 2;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    setShowFade(hasOverflow && !atBottom);
  }, []);

  React.useEffect(() => {
    updateFade();
  }, [content, updateFade]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => updateFade();
    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateFade);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateFade);
    };
  }, [updateFade]);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="max-h-56 overflow-y-auto scrollbar-slim pb-6 pr-2"
      >
        <StreamdownMarkdown className="text-base prose dark:prose-invert chat-markdown max-w-none break-words [&>:first-child]:mt-0 prose-headings:mt-3">
          {content}
        </StreamdownMarkdown>
      </div>
      {showFade && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted to-transparent" />
      )}
    </div>
  );
};

// Helpers
const safeLen = (arr: any): number => (Array.isArray(arr) ? arr.length : 0);
const isTruthy = (v: any) => !!v;
const asArray = (v: any): any[] => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (typeof v === 'object') return Object.values(v);
  return [v];
};
const toObject = (out: any): any => {
  if (out === null || out === undefined) return {};
  if (typeof out === 'string') {
    try {
      const parsed = JSON.parse(out);
      return typeof parsed === 'object' && parsed !== null ? parsed : { text: out };
    } catch {
      return { text: out };
    }
  }
  if (typeof out !== 'object') return { value: out };
  return out;
};

const resolveLocale = (): string => {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.lang || navigator.language;
    if (lang) return lang;
  }
  return 'en';
};

const isZhLocale = (): boolean => resolveLocale().toLowerCase().startsWith('zh');
const toCleanText = (value: any, maxLen = 140): string => {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
};
const isLikelyCode = (value: string): boolean => {
  if (!value) return false;
  if (value.includes('```')) return true;
  if (/[{}\[\]]/.test(value) && /":/.test(value)) return true;
  return false;
};

const STEP_PREFIX_RE = /^(step\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|步骤\s*[一二三四五六七八九十\d]+|第\s*[一二三四五六七八九十\d]+\s*步|\d+[.)、])/i;

const formatStepContent = (content: string, index: number, isZh: boolean): string => {
  const trimmed = content.trim();
  const prefix = isZh ? `步骤 ${index + 1}` : `Step ${index + 1}`;
  if (!trimmed) return prefix;
  if (STEP_PREFIX_RE.test(trimmed)) return trimmed;
  return `${prefix}: ${trimmed}`;
};

// Per-tool summarizers
function summarizeTasks(exec: ToolExecution): InlineSummary | null {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const sections = asArray(out.sections);
  const totalTasks = out.total_tasks ?? sections.reduce((acc: number, s: any) => acc + safeLen(s.tasks), 0);
  const label = '任务清单';
  const isZh = isZhLocale();

  const allTasks = sections.flatMap((s: any) => asArray(s.tasks || []).map((t: any) => ({ ...t, _section: s })));
  const doneCount = allTasks.filter((t: any) => {
    const status = String(t.status || '').toLowerCase();
    return status === 'completed' || status === 'cancelled';
  }).length;
  const currentTask = allTasks.find((t: any) => {
    const status = String(t.status || '').toLowerCase();
    return status !== 'completed' && status !== 'cancelled';
  });

  const line = totalTasks ? `已完成 ${doneCount} / ${totalTasks}` : '暂无任务';

  const showDetails = sections.length > 0;
  const details = showDetails ? (
    <div className="space-y-3 text-sm">
      {sections.map((s: any, idx: number) => {
        const tasks = asArray(s.tasks);
        const title = (s.title || '').trim();
        const hideTitle = !title || ['inbox', 'todo', 'to do', '待办', '任务'].includes(title.toLowerCase());
        return (
          <div key={s.id || s.title || idx} className="space-y-2">
            {!hideTitle && (
              <div className="text-xs font-medium text-muted-foreground">{title}</div>
            )}
            <div className="space-y-1">
              {tasks.length === 0 && (
                <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground">暂无任务</div>
              )}
              {tasks.map((t: any, tIdx: number) => {
                const status = String(t.status || '').toLowerCase();
                const isDone = status === 'completed' || status === 'cancelled';
                const isCurrent = (t.id && currentTask?.id && t.id === currentTask.id) || t.status === 'current' || t.is_current;
                const rawContent = (t.content || t.title || '').trim() || '未命名任务';
                const displayContent = formatStepContent(rawContent, tIdx, isZh);
                return (
                  <div
                    key={t.id || tIdx}
                    className={cn(
                      "flex items-start gap-2 px-1.5 py-0.5",
                      isCurrent ? "bg-transparent" : "bg-transparent"
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 rounded-xs border-2 border-muted-foreground/70 flex items-center justify-center",
                        isDone ? "bg-foreground border-foreground dark:bg-foreground/70 dark:border-foreground/70" : "",
                        isCurrent ? "border-emerald-500 dark:border-emerald-400" : ""
                      )}
                      aria-label={isDone ? "完成" : "未完成"}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          "text-sm leading-relaxed line-clamp-2",
                          isDone ? "line-through text-muted-foreground" : "text-foreground",
                          isCurrent ? "text-emerald-600 dark:text-emerald-400" : ""
                        )}
                        title={displayContent}
                      >
                        {displayContent}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  ) : undefined;

  return { label, line, details };
}

function summarizeWebSearch(exec: ToolExecution, intelligent = false): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const data = typeof out.data === 'object' && out.data !== null ? out.data : undefined;
  const q = out.query || data?.search_query || data?.query || exec.arguments?.query || '';
  const results = asArray(out.results || data?.results);
  const total = out.total_results ?? data?.total_results ?? results.length;
  const label = intelligent ? 'Web Search' : 'Web Search';
  const line = `"${q}" · ${total || 0} result(s)`;
  const details = results.length > 0 ? (
    <div className="space-y-2 text-xs">
      {results.slice(0, 10).map((r: any, i: number) => (
        <div key={`${r.url || 'result'}-${i}`} className="space-y-0.5">
          <div className="font-medium truncate" title={r.title}>{r.title || r.url}</div>
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{r.url}</a>
          )}
          {r.snippet || r.content || r.description || r.summary ? (
            <div className="text-muted-foreground truncate" title={r.snippet || r.content || r.description || r.summary}>
              {r.snippet || r.content || r.description || r.summary}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeExtract(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const data = typeof out.data === 'object' && out.data !== null ? out.data : undefined;
  const items = asArray(out.extracted_content || data?.extracted_content);
  const failed = asArray(out.failed_extractions || data?.failed_extractions);
  const total = out.total_urls ?? data?.total_urls ?? (items.length + failed.length);
  const label = 'Extract';
  const line = total ? `${safeLen(items)}/${total} URL(s) · extracted` : `${safeLen(items)} URL(s) · extracted`;
  const details = items.length > 0 ? (
    <div className="space-y-3 text-xs">
      {items.map((item: any, i: number) => (
        <div key={`${item.url || 'item'}-${i}`} className="space-y-1">
          <div className="font-medium truncate" title={item.title || item.url}>{item.title || item.url}</div>
          {item.url && (
            <a className="text-primary hover:underline break-all" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
          )}
          {item.summary && <div className="text-muted-foreground">{item.summary}</div>}
        </div>
      ))}
      {failed.length > 0 && (
        <div className="space-y-1 text-destructive">
          <div className="font-medium">Failed ({failed.length}):</div>
          {failed.slice(0, 5).map((f: any, idx: number) => (
            <div key={`${f.url || 'fail'}-${idx}`} className="flex flex-col gap-0.5 text-xs">
              <span className="truncate" title={f.url}>{f.url}</span>
              {f.error && <span className="text-muted-foreground">{f.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeGenerateDocument(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const label = 'Document';
  const line = `"${out.title || 'Untitled'}" (${out.format || 'doc'}) generated`;
  const details = (out.document || out.metadata?.template || out.content_preview) ? (
    <div className="text-xs space-y-1">
      {out.document && <div>File: {out.document}</div>}
      {out.metadata?.template && <div>Template: {String(out.metadata.template)}</div>}
      {out.content_preview && (
        <details>
          <summary className="cursor-pointer select-none">Preview</summary>
          <pre className="mt-1 p-2 bg-muted/30 rounded border overflow-auto whitespace-pre-wrap text-[11px]">{out.content_preview}</pre>
        </details>
      )}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeAnalyzeDocument(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const scores = typeof out.readability_scores === 'object' && out.readability_scores !== null ? out.readability_scores : {};
  const label = 'Doc Analysis';
  const line = `RE ${scores.flesch_reading_ease ?? '-'} · Grade ${scores.flesch_kincaid_grade_level ?? '-'}`;
  const details = (Object.keys(scores).length > 0 || out.summary) ? (
    <div className="text-xs grid grid-cols-2 gap-2">
      {Object.entries(scores).map(([k, v]) => (
        <div key={k} className="flex justify-between"><span className="text-muted-foreground">{toTitleCase(k)}</span><span>{String(v)}</span></div>
      ))}
      {out.summary && <div className="col-span-2 text-muted-foreground">{out.summary}</div>}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeAnalyzeData(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const stats = typeof out.statistics === 'object' && out.statistics !== null ? out.statistics : {};
  const trends = typeof out.trends === 'object' && out.trends !== null ? out.trends : {};
  const label = 'Data Analysis';
  const line = `Mean ${stats.mean ?? '-'} · Trend ${trends.direction || '-'}`;
  const details = (Object.keys(stats).length > 0 || trends.description) ? (
    <div className="text-xs space-y-1">
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{toTitleCase(k)}</span>
            <span>{String(v)}</span>
          </div>
        ))}
      </div>
      {trends.description && <div className="text-muted-foreground">{trends.description}</div>}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeGenerateInsights(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const insights = asArray(out.insights);
  const label = 'Insights';
  const line = `${safeLen(insights)} insight(s)`;
  const details = (insights.length > 0 || out.summary) ? (
    <div className="text-xs space-y-2">
      {insights.map((i: any, idx: number) => (
        <div key={idx}>
          <div className="font-medium">{i?.type || 'Insight'}</div>
          <div className="text-muted-foreground">{i?.description || String(i)}</div>
        </div>
      ))}
      {out.summary && <div className="text-muted-foreground">{out.summary}</div>}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeSearchImages(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const label = 'Image Search';
  const q = out.query || exec.arguments?.query || '';
  const results = asArray(out.results);
  const line = `"${q}" · ${(out.total_results ?? results.length) || 0} result(s)`;
  const details = results.length > 0 ? (
    <div className="text-xs space-y-2">
      {results.slice(0, 10).map((img: any, idx: number) => (
        <div key={`${img.url || 'img'}-${idx}`} className="space-y-0.5">
          <div className="font-medium truncate" title={img.title || img.url}>{img.title || img.url}</div>
          {img.url && <a href={img.url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{img.url}</a>}
        </div>
      ))}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeAnalyzeImage(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const label = 'Image Analysis';
  const line = out.description ? `${String(out.description).slice(0, 60)}` : 'Image analysis result';
  const details = (out.description || asArray(out.objects).length > 0) ? (
    <div className="text-xs space-y-2">
      {out.description && <div className="text-muted-foreground">{out.description}</div>}
      {asArray(out.objects).length > 0 && (
        <div>
          <div className="font-medium">Objects</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {asArray(out.objects).map((o: any, idx: number) => (
              <span key={idx} className="inline-flex items-center rounded px-1.5 py-0.5 border text-[10px]">{o?.object || String(o)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeListSkills(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const skills = asArray(out.skills).filter((s) => s && typeof s === 'object');
  const isZh = isZhLocale();
  const label = isZh ? '技能列表' : 'Skills';
  const line = isZh ? `共 ${skills.length} 个技能` : `${skills.length} skills`;
  const details = skills.length > 0 ? (
    <div className="space-y-2 text-xs">
      {skills.slice(0, 12).map((s: any, idx: number) => {
        const name = toCleanText(s?.name) || toCleanText(s?.title) || toCleanText(s?.id) || '未命名技能';
        const desc = toCleanText(s?.description, 120);
        const disabled = s?.enabled === false || s?.disabled === true;
        return (
          <div key={`${s?.id || s?.name || idx}`} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">{name}</span>
              {disabled && <span className="text-[10px] text-muted-foreground">已停用</span>}
            </div>
            {desc && <div className="text-muted-foreground">{desc}</div>}
          </div>
        );
      })}
    </div>
  ) : undefined;
  return { label, line, details };
}

function summarizeRunSkill(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const isZh = isZhLocale();
  const skillId = toCleanText(exec.arguments?.skill_id || out.skill_id || out.skillId, 80);
  const label = isZh ? '技能执行' : 'Skill Run';
  const line = skillId ? (isZh ? `已完成：${skillId}` : `Completed: ${skillId}`) : (isZh ? '已完成' : 'Completed');

  let summary = '';
  const output = out.output || {};
  const candidates = [
    output?.summary,
    output?.result_summary,
    output?.message,
    output?.text,
    output?.content,
    out.summary,
    out.message,
    out.text,
  ];
  for (const candidate of candidates) {
    const text = toCleanText(candidate, 240);
    if (text && !isLikelyCode(text)) {
      summary = text;
      break;
    }
  }

  const details = (
    <div className="text-xs text-muted-foreground">
      {summary || (isZh ? '已完成技能流程，结果已应用到后续步骤。' : 'Skill completed; results applied to the next steps.')}
    </div>
  );
  return { label, line, details };
}

function summarizeInstallSkill(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
  const isZh = isZhLocale();
  const label = isZh ? '安装技能' : 'Install Skill';

  const skill = toObject(out.skill);
  const skillName =
    toCleanText(skill?.name || out.skill_name || out.name, 80) ||
    toCleanText(exec.arguments?.marketplace_skill_id || exec.arguments?.github_url, 80) ||
    (isZh ? '未命名技能' : 'Unnamed skill');

  const created = typeof out.created === 'boolean' ? out.created : undefined;
  const line = created === false
    ? (isZh ? `已更新：${skillName}` : `Updated: ${skillName}`)
    : (isZh ? `已安装：${skillName}` : `Installed: ${skillName}`);

  const compatibility = toObject(out.compatibility);
  const compatibilityStatus = toCleanText(
    compatibility?.status || compatibility?.compatibility_status,
    40
  );
  const compatibilityReason = toCleanText(
    compatibility?.reason || compatibility?.compatibility_reason,
    140
  );
  const sourceType = toCleanText(exec.arguments?.source_type, 40);
  const message = toCleanText(out.message, 180);

  const detailsLines: string[] = [];
  if (sourceType) {
    detailsLines.push(`${isZh ? '来源' : 'Source'}: ${sourceType}`);
  }
  if (compatibilityStatus) {
    const statusLabel = compatibilityReason
      ? `${compatibilityStatus} · ${compatibilityReason}`
      : compatibilityStatus;
    detailsLines.push(`${isZh ? '兼容性' : 'Compatibility'}: ${statusLabel}`);
  }
  if (message) {
    detailsLines.push(message);
  }

  const details = detailsLines.length > 0 ? (
    <div className="text-xs text-muted-foreground space-y-1">
      {detailsLines.map((item, idx) => (
        <div key={`install-skill-detail-${idx}`}>{item}</div>
      ))}
    </div>
  ) : undefined;

  return { label, line, details };
}

function summarizeGeneric(exec: ToolExecution): InlineSummary {
  const out = toObject(sanitizeForDisplay(exec.result?.output || exec.result || {}));
  const isZh = isZhLocale();
  const label = toTitleCase(normalizeKey(exec));
  const error = exec.result?.error ? toCleanText(String(exec.result.error), 160) : '';

  const extractSummary = (payload: any): string => {
    const candidates = [
      payload?.summary,
      payload?.message,
      payload?.text,
      payload?.content,
      payload?.description,
      payload?.result_summary,
      payload?.note,
    ];
    for (const candidate of candidates) {
      const text = toCleanText(candidate, 160);
      if (text && !isLikelyCode(text)) return text;
    }
    if (Array.isArray(payload)) {
      return isZh ? `共 ${payload.length} 条` : `${payload.length} items`;
    }
    const listKeys = ['items', 'results', 'files', 'entries', 'records', 'rows', 'templates', 'skills', 'slides'];
    for (const key of listKeys) {
      const list = payload?.[key];
      if (Array.isArray(list)) {
        return isZh ? `共 ${list.length} 条` : `${list.length} items`;
      }
    }
    return '';
  };

  const summary = extractSummary(out) || extractSummary(out.output || {});
  const line = error
    ? (isZh ? `失败：${error}` : `Failed: ${error}`)
    : summary || (isZh ? '已完成' : 'Completed');

  const detailsLines: string[] = [];
  const metrics = [
    { key: 'status', zh: '状态', en: 'Status' },
    { key: 'count', zh: '数量', en: 'Count' },
    { key: 'total', zh: '总数', en: 'Total' },
    { key: 'generated', zh: '生成', en: 'Generated' },
    { key: 'failed', zh: '失败', en: 'Failed' },
    { key: 'skipped', zh: '跳过', en: 'Skipped' },
  ];
  metrics.forEach(({ key, zh, en }) => {
    const value = out?.[key];
    if (value === undefined || value === null) return;
    if (typeof value === 'object') return;
    detailsLines.push(`${isZh ? zh : en}: ${String(value)}`);
  });

  const warnings = asArray(out?.warnings).map((w) => toCleanText(w, 80)).filter(Boolean);
  if (warnings.length > 0) {
    const head = warnings.slice(0, 2).join(isZh ? '；' : '; ');
    detailsLines.push(`${isZh ? '提示' : 'Warnings'}: ${head}`);
  }

  const fileName = toCleanText(out?.file_name || out?.fileName || out?.filename, 120);
  if (fileName) {
    detailsLines.push(`${isZh ? '文件' : 'File'}: ${fileName}`);
  }

  const details = detailsLines.length > 0 ? (
    <div className="text-xs text-muted-foreground space-y-1">
      {detailsLines.map((item, idx) => (
        <div key={`${label}-detail-${idx}`}>{item}</div>
      ))}
    </div>
  ) : undefined;

  return { label, line, details };
}

export function summarize(exec: ToolExecution): InlineSummary {
  const key = normalizeKey(exec);
  if (key.startsWith('transfer-to-')) {
    const display = getSubagentDisplayName(exec, key);
    const label = display ? `Subagent: ${display}` : 'Subagent';
    const error = exec.result?.error;
    const content = extractSubagentContent(exec);
    const line = error ? 'Failed' : undefined;
    const details = error ? (
      <div className="text-xs text-destructive">{String(error)}</div>
    ) : content ? (
      <SubagentOutput content={content} />
    ) : undefined;
    return { label, line, details };
  }
  // Canvas tools
  if (key === 'canvas-list') {
    const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
    const items = asArray(out.canvases);
    const line = `${safeLen(items)} canvas(es)`;
    const details = items.length > 0 ? (
      <div className="text-xs space-y-2">
        <div className="text-muted-foreground mb-1">{line}</div>
        {items.slice(0, 10).map((c: any, idx: number) => (
          <div key={`${c.id || idx}`} className="flex items-center gap-2">
            <span className="font-medium truncate" title={c.title || c.id}>{c.title || c.id}</span>
            <span className="text-muted-foreground">{c.id}</span>
          </div>
        ))}
      </div>
    ) : (
        <div className="text-xs text-muted-foreground">{line}</div>
    );
    return { label: 'Canvas List', line, details };
  }
  if (key === 'canvas-read' || key === 'canvas-read-current' || key === 'canvas-get' || key === 'canvas-get-current') {
    const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
    const c = toObject(out.canvas);
    const info = `${c.title || c.id || 'Canvas'} (v${c.version || '?'}) · ${safeLen(c.nodes)} nodes, ${safeLen(c.connections)} connections`;
    const details = (
      <div className="text-xs text-muted-foreground">{info}</div>
    );
    // 不返回 line，避免上方摘要重复；只在组件框内显示详情
    return { label: 'Canvas Read', line: undefined, details };
  }
  if (key === 'canvas-list-versions') {
    const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
    const versions = asArray(out.versions);
    const line = `${safeLen(versions)} version(s)`;
    const details = versions.length > 0 ? (
      <div className="text-xs space-y-2">
        <div className="text-muted-foreground mb-1">{line}</div>
        {versions.slice(0, 10).map((v: any) => (
          <div key={v.id} className="flex items-center gap-2">
            <span className="text-muted-foreground">{v.id}</span>
            <span className="truncate" title={v.created_at}>{v.created_at}</span>
          </div>
        ))}
      </div>
    ) : (
        <div className="text-xs text-muted-foreground">{line}</div>
    );
    return { label: 'Canvas Versions', line, details };
  }
  if (key === 'canvas-restore-version' || key === 'canvas-delete-version') {
    const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
    const info = key === 'canvas-restore-version' ? 'Restored version' : 'Deleted version';
    const details = (
      <div className="text-xs text-muted-foreground">{info}</div>
    );
    return { label: 'Canvas Version', line: undefined, details };
  }
  if (key === 'canvas-edit') {
    const out = toObject(sanitizeForDisplay(exec.result?.output || {}));
    const applied = asArray(out.applied);
    const counts: Record<string, number> = {};
    applied.forEach((a: any) => { const k = a?.op || 'op'; counts[k] = (counts[k] || 0) + 1; });
    const parts = Object.entries(counts).map(([k, v]) => `${k} ${v}`);
    const line = parts.length ? `Applied ${applied.length} op(s): ${parts.join(', ')}` : `Applied ${applied.length} op(s)`;
    const details = applied.length > 0 ? (
      <div className="text-xs space-y-2">
        <div className="text-muted-foreground mb-1">{line}</div>
        {applied.slice(0, 10).map((a: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="inline-flex items-center rounded px-1.5 py-0.5 border text-[10px]">{a.op}</span>
            <span className="text-muted-foreground">{a.id || ''}</span>
          </div>
        ))}
      </div>
    ) : (
         <div className="text-xs text-muted-foreground">{line}</div>
    );
    // 仅在组件框内显示详情，避免重复行
    return { label: 'Canvas Edit', line: undefined, details };
  }
  if (key === 'list-skills') return summarizeListSkills(exec);
  if (key === 'install-skill') return summarizeInstallSkill(exec);
  if (key === 'run-skill') return summarizeRunSkill(exec);
  if (key.includes('task')) return summarizeTasks(exec) || summarizeGeneric(exec);
  if (key === 'intelligent-web-search') return summarizeWebSearch(exec, true);
  if (key === 'web-search') return summarizeWebSearch(exec, false);
  if (key === 'extract-web-content') return summarizeExtract(exec);
  if (key === 'generate-document') return summarizeGenerateDocument(exec);
  if (key === 'analyze-document') return summarizeAnalyzeDocument(exec);
  if (key === 'analyze-data') return summarizeAnalyzeData(exec);
  if (key === 'generate-insights') return summarizeGenerateInsights(exec);
  if (key === 'search-images') return summarizeSearchImages(exec);
  if (key === 'analyze-image-content') return summarizeAnalyzeImage(exec);
  return summarizeGeneric(exec);
}
