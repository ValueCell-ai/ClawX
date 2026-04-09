/**
 * Trinity Dashboard
 * 三核永动框架实时监控仪表盘
 * 显示 AI3 唤醒间隔控制 / PROGRESS.md / NEAR_MISS.log / STATE.json
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Activity,
  Target,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  FolderOpen,
  Crown,
  Zap,
  Shield,
  BookOpen,
  Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TrinityState {
  goal_version?: string;
  trust_stage?: number;
  current_milestone?: string;
  milestone_progress?: Record<string, number>;
  ai3_confidence?: number;
  consecutive_passes?: number;
  budget?: { daily_token_limit: number; used_today: number; remaining_pct: number };
  last_value_gate_score?: number | null;
  near_miss_count?: number;
  playbook_count?: number;
  active_task?: string | null;
  last_updated?: string;
  notes?: string;
  ai3_cron_interval_minutes?: number;
  ai3_cron_expr?: string;
}

interface TrinityFiles {
  state: TrinityState;
  goal: string;
  progress: string;
  nearMiss: string;
  debt: string;
  trinityDir: string;
}

// ─── Interval presets ──────────────────────────────────────────────────────────

interface IntervalPreset {
  label: string;
  minutes: number;
  cronExpr: string;
}

const INTERVAL_PRESETS: IntervalPreset[] = [
  { label: '1 分钟',  minutes: 1,    cronExpr: '* * * * *' },
  { label: '5 分钟',  minutes: 5,    cronExpr: '*/5 * * * *' },
  { label: '15 分钟', minutes: 15,   cronExpr: '*/15 * * * *' },
  { label: '30 分钟', minutes: 30,   cronExpr: '*/30 * * * *' },
  { label: '1 小时',  minutes: 60,   cronExpr: '0 * * * *' },
  { label: '2 小时',  minutes: 120,  cronExpr: '0 */2 * * *' },
  { label: '4 小时',  minutes: 240,  cronExpr: '7 */4 * * *' },
  { label: '8 小时',  minutes: 480,  cronExpr: '0 */8 * * *' },
  { label: '12 小时', minutes: 720,  cronExpr: '0 */12 * * *' },
  { label: '24 小时', minutes: 1440, cronExpr: '0 9 * * *' },
];

function minutesToLabel(mins?: number): string {
  if (!mins) return '未设置';
  const preset = INTERVAL_PRESETS.find((p) => p.minutes === mins);
  if (preset) return preset.label;
  if (mins < 60) return `${mins} 分钟`;
  return `${Math.round(mins / 60)} 小时`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stageLabel(stage: number): string {
  const labels: Record<number, string> = {
    1: 'Stage 1 · 初始（每轮确认）',
    2: 'Stage 2 · 基本信任（里程碑确认）',
    3: 'Stage 3 · 成熟运行（每周查看）',
    4: 'Stage 4 · 完全信任（仅告警介入）',
  };
  return labels[stage] ?? `Stage ${stage}`;
}

function stageColor(stage: number): string {
  if (stage >= 4) return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
  if (stage >= 3) return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
  if (stage >= 2) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
  return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30';
}

function confidenceColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct * 100)));
  const color = clamped >= 80 ? 'bg-green-500' : clamped >= 40 ? 'bg-blue-500' : 'bg-zinc-400';
  return (
    <div className={cn('w-full h-1.5 bg-muted rounded-full overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function parseNearMiss(raw: string) {
  const results: Array<{ task_id?: string; score?: number; date?: string; gap_analysis?: string }> = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{')) { try { results.push(JSON.parse(t)); } catch { /* skip */ } }
  }
  return results.slice(-5).reverse();
}

function countProgressEntries(raw: string): number {
  return (raw.match(/^## /gm) ?? []).length;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AiRoleCard({ emoji, name, subtitle, color, active }: {
  emoji: string; name: string; subtitle: string; color: string; active?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-lg border transition-all',
      active ? `${color} border-current/30` : 'bg-muted/40 border-border text-muted-foreground',
    )}>
      <span className="text-xl leading-none">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[13px] leading-tight">{name}</div>
        <div className="text-[11px] opacity-70 truncate">{subtitle}</div>
      </div>
      {active && <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse shrink-0" />}
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
          {icon}
          <span className="text-[11px] font-medium">{label}</span>
        </div>
        <div className={cn('text-xl font-bold leading-none', accent)}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Interval Selector ─────────────────────────────────────────────────────────

function IntervalSelector({ currentMinutes, onChanged }: {
  currentMinutes?: number;
  onChanged: (mins: number) => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const mins = Number(e.target.value);
    if (!mins || saving) return;
    setSaving(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('trinity:setAI3Interval', mins) as { ok?: boolean; error?: string };
      const preset = INTERVAL_PRESETS.find((p) => p.minutes === mins);
      if (result?.ok) {
        toast.success(`AI3 唤醒间隔已设为 ${preset?.label ?? `${mins}分钟`}`);
        onChanged(mins);
      } else {
        toast.error(`设置失败：${result?.error ?? '未知错误'}`);
      }
    } catch (err) {
      toast.error('IPC 调用失败');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const isTest = currentMinutes !== undefined && currentMinutes <= 5;

  return (
    <div className="flex items-center gap-1.5">
      <Timer className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0', saving && 'animate-spin')} />
      <Select
        value={currentMinutes?.toString() ?? ''}
        onChange={handleChange}
        disabled={saving}
        className="h-7 text-xs py-0 pr-7 min-w-[130px]"
      >
        <option value="" disabled>AI3 唤醒间隔</option>
        {INTERVAL_PRESETS.map((p) => (
          <option key={p.minutes} value={p.minutes}>
            {p.label}{p.minutes <= 5 ? ' (测试)' : ''}
          </option>
        ))}
      </Select>
      {isTest && (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 shrink-0">
          测试中
        </Badge>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function Trinity() {
  const [files, setFiles] = useState<TrinityFiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState<number | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await window.electron.ipcRenderer.invoke('trinity:readFiles');
      setFiles(data as TrinityFiles);
      const state = (data as TrinityFiles).state;
      if (state.ai3_cron_interval_minutes) {
        setIntervalMinutes(state.ai3_cron_interval_minutes);
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[Trinity] load error:', err);
      toast.error('无法读取 Trinity 文件，请确认 ~/.newclaw/trinity/ 已初始化');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh: every 30s normally, every intervalMinutes if interval <= 5min
  useEffect(() => {
    load();
    const refreshMs = intervalMinutes && intervalMinutes <= 5 ? 20_000 : 30_000;
    intervalRef.current = setInterval(load, refreshMs);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load, intervalMinutes]);

  const handleIntervalChanged = useCallback((mins: number) => {
    setIntervalMinutes(mins);
    // Re-trigger load to update UI
    setTimeout(load, 500);
  }, [load]);

  // ── Loading / Error states ──

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-muted-foreground gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span className="text-sm">加载 Trinity 状态...</span>
      </div>
    );
  }

  if (!files) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <AlertTriangle className="h-10 w-10 text-yellow-500" />
        <div className="text-center">
          <div className="font-semibold text-base mb-1">Trinity 文件系统未就绪</div>
          <div className="text-sm">请确认 ~/.newclaw/trinity/ 已初始化</div>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />重试
        </Button>
      </div>
    );
  }

  const { state, progress, nearMiss, debt } = files;
  const milestones = state.milestone_progress ?? {};
  const stage = state.trust_stage ?? 1;
  const confidence = state.ai3_confidence ?? 0;
  const nearMissItems = parseNearMiss(nearMiss);
  const progressCount = countProgressEntries(progress);
  const budgetPct = state.budget?.remaining_pct ?? 100;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-yellow-500 shrink-0" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Trinity 仪表盘</h1>
            <p className="text-[11px] text-muted-foreground">
              三核永动框架 · GOAL {state.goal_version ?? 'v1'} · {stageLabel(stage)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* AI3 Interval Selector */}
          <IntervalSelector
            currentMinutes={intervalMinutes ?? state.ai3_cron_interval_minutes}
            onChanged={handleIntervalChanged}
          />

          {lastRefresh && (
            <span className="text-[11px] text-muted-foreground hidden md:block ml-1">
              {lastRefresh.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={load} title="手动刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="打开文件夹"
            onClick={() => window.electron.ipcRenderer.invoke('shell:openPath', files.trinityDir)}>
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* 三核角色卡 */}
        <div className="grid grid-cols-3 gap-2">
          <AiRoleCard emoji="🎭" name="AI1 扩张者" subtitle="执行 CEO · 生成方案"
            color="text-blue-600 dark:text-blue-400 bg-blue-500/10" active={state.active_task != null} />
          <AiRoleCard emoji="🧊" name="AI2 审计员" subtitle="审计 CEO · 风险评估"
            color="text-purple-600 dark:text-purple-400 bg-purple-500/10" active={state.active_task != null} />
          <AiRoleCard emoji="👑" name="AI3 指挥官" subtitle={`每 ${minutesToLabel(intervalMinutes ?? state.ai3_cron_interval_minutes)} 唤醒`}
            color="text-yellow-600 dark:text-yellow-400 bg-yellow-500/10" active={true} />
        </div>

        {/* 渐进信任阶梯 */}
        <div className={cn('rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3', stageColor(stage))}>
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-semibold text-[13px]">{stageLabel(stage)}</div>
              <div className="text-[11px] opacity-75">连续通过 {state.consecutive_passes ?? 0} 轮 ≥80分</div>
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={cn(
                'h-1.5 w-5 rounded-full transition-all',
                s <= stage ? 'bg-current opacity-90' : 'bg-current opacity-20',
              )} />
            ))}
          </div>
        </div>

        {/* 关键指标 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard
            icon={<Activity className="h-3 w-3" />}
            label="AI3 置信度"
            value={<span className={confidenceColor(confidence)}>{confidence}%</span>}
            sub={confidence < 50 ? '⚠️ 已暂停' : confidence >= 80 ? '✓ 自动继续' : '正常运行'}
          />
          <StatCard
            icon={<TrendingUp className="h-3 w-3" />}
            label="PROGRESS 记录"
            value={progressCount}
            sub="Value Gate ≥80"
          />
          <StatCard
            icon={<AlertTriangle className="h-3 w-3" />}
            label="近失效记录"
            value={state.near_miss_count ?? nearMissItems.length}
            sub="65-79分学习信号"
          />
          <StatCard
            icon={<BookOpen className="h-3 w-3" />}
            label="Playbook 数"
            value={state.playbook_count ?? 0}
            sub="知识结晶"
          />
        </div>

        {/* 里程碑进度 */}
        <Card>
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5" />里程碑进度
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            {Object.entries(milestones).map(([key, pct]) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    {key === state.current_milestone && (
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                    )}
                    {key}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{Math.round(pct * 100)}%</span>
                </div>
                <ProgressBar pct={pct} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Token 预算 */}
        {state.budget && (
          <Card>
            <CardHeader className="pb-1.5 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />Token 预算
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {state.budget.used_today.toLocaleString()} / {state.budget.daily_token_limit.toLocaleString()}
                </span>
                <Badge variant="outline" className={cn('text-[11px] h-5',
                  budgetPct > 70 ? 'text-green-600' : budgetPct > 30 ? 'text-yellow-600' : 'text-red-600',
                )}>
                  余 {budgetPct}%
                </Badge>
              </div>
              <ProgressBar pct={budgetPct / 100} />
              <div className="text-[11px] text-muted-foreground mt-1.5">
                {budgetPct > 70 ? '✓ 完整三核模式' : budgetPct > 30 ? '双核模式' : budgetPct > 10 ? '单核模式' : '💤 休眠模式'}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 近失效学习区 */}
        {nearMissItems.length > 0 && (
          <Card>
            <CardHeader className="pb-1.5 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                近失效学习区
                <span className="text-[11px] font-normal text-muted-foreground">65-79分</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              {nearMissItems.map((item, i) => (
                <div key={i} className="rounded-md bg-yellow-500/8 border border-yellow-500/20 px-3 py-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] font-mono text-muted-foreground">{item.task_id ?? `#${i + 1}`}</span>
                    <Badge variant="outline" className="text-[11px] text-yellow-600 border-yellow-500/40 h-4 px-1.5">
                      {item.score ?? '—'}分
                    </Badge>
                  </div>
                  {item.gap_analysis && (
                    <div className="text-[11px] text-foreground/80 leading-snug">{item.gap_analysis}</div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* PROGRESS.md */}
        {progress && (
          <Card>
            <CardHeader className="pb-1.5 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                PROGRESS.md
                <span className="text-[11px] font-normal text-muted-foreground">最近60行</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/70 font-mono max-h-52 overflow-y-auto">
                {progress}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* DEBT.md */}
        {debt && (
          <Card>
            <CardHeader className="pb-1.5 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-orange-500" />战略债务 DEBT.md
              </CardTitle>
              <CardDescription className="text-[11px]">被推迟的主线任务</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/70 font-mono max-h-36 overflow-y-auto">
                {debt}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* 状态备注 */}
        {(state.active_task || state.notes || state.last_updated) && (
          <Card>
            <CardContent className="pt-3 pb-3 px-4 space-y-1">
              {state.active_task && (
                <div className="flex items-center gap-2">
                  <Activity className="h-3 w-3 text-blue-500 shrink-0" />
                  <span className="text-[11px] font-mono">{state.active_task}</span>
                </div>
              )}
              {state.notes && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{state.notes}</p>
              )}
              {state.last_updated && (
                <p className="text-[11px] text-muted-foreground/60">
                  STATE 更新：{new Date(state.last_updated).toLocaleString('zh-CN')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="h-3" />
      </div>
    </div>
  );
}
