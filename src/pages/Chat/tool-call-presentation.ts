import {
  Activity,
  BookOpen,
  Bot,
  CalendarClock,
  CloudCog,
  CodeXml,
  Database,
  FileDiff,
  FilePenLine,
  FileSearch,
  FileText,
  Globe,
  Hourglass,
  Info,
  KeyRound,
  LibraryBig,
  ListChecks,
  ListTree,
  MessageSquareText,
  MonitorPlay,
  MousePointerClick,
  Pause,
  Play,
  Save,
  ScanText,
  Search,
  SearchCode,
  SquareMousePointer,
  UserRoundPen,
  Workflow,
} from 'lucide-react';
import { basenameOf } from '@/lib/generated-files';
import type { ToolCallItem } from '@/lib/acp/timeline-types';

const EXEC_CODE_PRESENTATION = { icon: CodeXml, iconName: 'code-xml', labelKey: 'acp.toolName.execCode' } as const;

const TOOL_PRESENTATIONS = {
  update_plan: { icon: ListChecks, iconName: 'list-checks', labelKey: 'acp.toolName.updatePlan' },
  web_fetch: { icon: Globe, iconName: 'globe', labelKey: 'acp.toolName.webFetch' },
  browser: { icon: SquareMousePointer, iconName: 'square-mouse-pointer', labelKey: 'acp.toolName.browser' },
  computer: { icon: MousePointerClick, iconName: 'mouse-pointer-click', labelKey: 'acp.toolName.computer' },
  exec: { icon: MonitorPlay, iconName: 'monitor-play', labelKey: 'acp.toolName.execCommand' },
  ls: { icon: ListTree, iconName: 'list-tree', labelKey: 'acp.toolName.listFiles' },
  read: { icon: ScanText, iconName: 'scan-text', labelKey: 'acp.toolName.read' },
  write: { icon: Save, iconName: 'save', labelKey: 'acp.toolName.write' },
  sessions_spawn: { icon: Bot, iconName: 'bot', labelKey: 'acp.toolName.spawnSubagent' },
  memory_search: { icon: Database, iconName: 'database', labelKey: 'acp.toolName.memorySearch' },
  edit: { icon: FilePenLine, iconName: 'file-pen-line', labelKey: 'acp.toolName.editFile' },
  apply_patch: { icon: FileDiff, iconName: 'file-diff', labelKey: 'acp.toolName.applyPatch' },
  process: { icon: Activity, iconName: 'activity', labelKey: 'acp.toolName.manageProcess' },
  code_execution: { icon: CloudCog, iconName: 'cloud-cog', labelKey: 'acp.toolName.remoteCode' },
  secrets: { icon: KeyRound, iconName: 'key-round', labelKey: 'acp.toolName.manageCredentials' },
  web_search: { icon: Search, iconName: 'search', labelKey: 'acp.toolName.webSearch' },
  x_search: { icon: MessageSquareText, iconName: 'message-square-text', labelKey: 'acp.toolName.xSearch' },
  memory_get: { icon: FileText, iconName: 'file-text', labelKey: 'acp.toolName.memoryRead' },
  personal_instructions: { icon: UserRoundPen, iconName: 'user-round-pen', labelKey: 'acp.toolName.editPersonalInstructions' },
  agents_wait: { icon: Hourglass, iconName: 'hourglass', labelKey: 'acp.toolName.waitSubagents' },
  sessions_yield: { icon: Pause, iconName: 'pause', labelKey: 'acp.toolName.awaitFollowUp' },
  subagents: { icon: Workflow, iconName: 'workflow', labelKey: 'acp.toolName.manageBackgroundTasks' },
  skill_workshop: { icon: LibraryBig, iconName: 'library-big', labelKey: 'acp.toolName.manageSkills' },
  skills_search: { icon: FileSearch, iconName: 'file-search', labelKey: 'acp.toolName.searchSkills' },
  skills_read: { icon: BookOpen, iconName: 'book-open', labelKey: 'acp.toolName.loadSkill' },
  wait: { icon: Hourglass, iconName: 'hourglass', labelKey: 'acp.toolName.waitExecution' },
  tool_search: { icon: SearchCode, iconName: 'search-code', labelKey: 'acp.toolName.searchTools' },
  tool_describe: { icon: Info, iconName: 'info', labelKey: 'acp.toolName.describeTool' },
  dispatch_action: { icon: Play, iconName: 'play', labelKey: 'acp.toolName.dispatchTool' },
  automations: { icon: CalendarClock, iconName: 'calendar-clock', labelKey: 'acp.toolName.manageAutomations' },
} as const;

function execPresentation(input: Record<string, unknown> | undefined, titleArguments: string) {
  if (typeof input?.code === 'string' && input.code.trim()) return EXEC_CODE_PRESENTATION;
  if (typeof input?.command === 'string' && input.command.trim()) return TOOL_PRESENTATIONS.exec;
  if (/^code:\s*\S/.test(titleArguments)) return EXEC_CODE_PRESENTATION;
  if (/^command:\s*\S/.test(titleArguments)) return TOOL_PRESENTATIONS.exec;
  return undefined;
}

function resolveToolPresentation(
  toolName: string,
  input: Record<string, unknown> | undefined,
  titleArguments: string,
) {
  if (toolName === 'exec') return execPresentation(input, titleArguments);
  if (toolName === 'bash') return execPresentation(input, titleArguments) ?? TOOL_PRESENTATIONS.exec;

  const name = toolName === 'cron' ? 'automations' : toolName;
  if (!Object.hasOwn(TOOL_PRESENTATIONS, name)) return undefined;
  return TOOL_PRESENTATIONS[name as keyof typeof TOOL_PRESENTATIONS];
}

function compactTarget(name: string, input: Record<string, unknown> | undefined) {
  if (!input) return undefined;
  switch (name) {
    case 'exec':
    case 'bash':
      return typeof input.title === 'string' ? input.title.trim() : undefined;
    case 'skills_read':
      return typeof input.name === 'string' ? input.name.trim() : undefined;
    case 'read':
    case 'write':
    case 'edit':
    case 'ls': {
      const path = typeof input.path === 'string' ? input.path.trim() : '';
      return basenameOf(path.replace(/[\\/]+$/, '')) || path;
    }
    default:
      return undefined;
  }
}

export function describeToolCall(item: ToolCallItem) {
  const input = typeof item.input === 'object' && item.input !== null
    ? item.input as Record<string, unknown>
    : undefined;
  const separator = item.title.indexOf(':');
  const name = (separator === -1 ? item.title : item.title.slice(0, separator)).trim();
  const argumentsSuffix = separator === -1 ? '' : item.title.slice(separator);
  const presentation = resolveToolPresentation(name, input, argumentsSuffix.slice(1).trim());
  return { name, argumentsSuffix, presentation, target: compactTarget(name, input) };
}
