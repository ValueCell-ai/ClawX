import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isToolCardError, type ToolCard as ToolCardModel } from '@/chat-core/openclaw-port/tool-cards';
import type { CommandOutputEntry } from '@/chat-core/openclaw-port/types';
import type { AttachedFileMeta } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { CommandDetails } from './CommandCard';

const COMMAND_TOOL_NAMES = new Set(['exec', 'shell', 'bash', 'sh', 'terminal', 'command']);

function parseToolInput(inputText: string | undefined): unknown {
  const trimmed = inputText?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) return trimmed;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === 'string' && entry.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return undefined;
}

function commandFromToolInput(inputText: string | undefined): string | undefined {
  const input = parseToolInput(inputText);
  if (typeof input === 'string') return input.trim() || undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return readStringField(input as Record<string, unknown>, ['command', 'cmd', 'script']);
}

function isCommandTool(toolName: string | undefined): boolean {
  const normalized = toolName?.trim().toLowerCase();
  return normalized ? COMMAND_TOOL_NAMES.has(normalized) : false;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) || filePath;
}

function mimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

function previewFileFromToolCard(card: ToolCardModel): AttachedFileMeta | null {
  const input = parseToolInput(card.inputText);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const filePath = readStringField(input as Record<string, unknown>, [
    'path',
    'filePath',
    'file_path',
    'targetPath',
    'target_path',
  ]);
  if (!filePath) return null;
  return {
    fileName: fileNameFromPath(filePath),
    filePath,
    mimeType: mimeFromPath(filePath),
    fileSize: 0,
    preview: null,
    source: 'tool-result',
  };
}

function commandDetailsFromToolCard(card: ToolCardModel, command: CommandOutputEntry | undefined): CommandOutputEntry | null {
  if (command) {
    return {
      ...command,
      output: command.output ?? card.outputText,
    };
  }

  const commandText = commandFromToolInput(card.inputText);
  if (!commandText && !isCommandTool(card.toolName)) return null;
  if (!commandText && !card.outputText) return null;
  return {
    id: `${card.id}:command-details`,
    runId: card.transcriptMessageId ?? card.id,
    title: commandText ? `command ${commandText}` : card.toolName ?? 'command',
    output: card.outputText,
    ts: 0,
  };
}

export function ToolCard({
  card,
  command,
  defaultOpen = false,
  autoExpandWhen = false,
  autoCollapseWhen = false,
  onOpenFile,
}: {
  card: ToolCardModel;
  command?: CommandOutputEntry;
  defaultOpen?: boolean;
  autoExpandWhen?: boolean;
  autoCollapseWhen?: boolean;
  onOpenFile?: (file: AttachedFileMeta) => void;
}) {
  const { t } = useTranslation('chat');
  const [manualOpen, setManualOpen] = useState<{ value: boolean; collapseState: boolean } | null>(null);
  const isError = isToolCardError(card);
  const toolName = card.toolName ?? 'tool';
  const title = t('toolCard.calling', { tool: toolName });
  const commandDetails = commandDetailsFromToolCard(card, command);
  const previewFile = previewFileFromToolCard(card);
  const autoOpen = autoCollapseWhen ? false : autoExpandWhen || defaultOpen;
  const open = manualOpen?.collapseState === autoCollapseWhen ? manualOpen.value : autoOpen;

  const toggleOpen = () => {
    setManualOpen({ value: !open, collapseState: autoCollapseWhen });
  };

  return (
    <div
      className={cn(
        'w-[50vw] max-w-[calc(100vw-8rem)] rounded-md border bg-surface-input text-sm',
        isError ? 'border-destructive/40' : 'border-border',
      )}
      data-testid="chat-tool-card"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={toggleOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" data-testid="chat-tool-card-icon" />
          <span className="truncate text-xs font-medium">{title}</span>
          {isError ? (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive">
              {t('toolCard.error')}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {open ? t('toolCard.hide') : t('toolCard.show')}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {previewFile && onOpenFile ? (
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              data-testid="chat-tool-card-preview"
              onClick={() => onOpenFile(previewFile)}
            >
              {t('toolCard.preview')}
            </button>
          ) : null}
          {commandDetails ? (
            <CommandDetails command={commandDetails} />
          ) : (
            <>
              {card.inputText ? <pre className="whitespace-pre-wrap text-xs">{card.inputText}</pre> : null}
              {card.outputText ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                  {card.outputText}
                </pre>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
