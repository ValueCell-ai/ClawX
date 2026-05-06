/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SendHorizontal, Square, X, Paperclip, FileText, Film, Music, FileArchive, File, Loader2, AtSign, Search, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rendererExtensionRegistry } from '@/extensions/registry';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;        // disk path for gateway
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getSkillPrefix(skillName: string): string {
  return `/${skillName}  `;
}

function needsLeadingSkillSpace(value: string, position: number): boolean {
  return position > 0 && !/\s/.test(value[position - 1] ?? '');
}

type SkillTokenRange = { start: number; end: number };

function findSkillTokenRange(value: string, skillName: string): SkillTokenRange | null {
  const token = getSkillPrefix(skillName);
  const start = value.indexOf(token);
  if (start === -1) return null;
  return { start, end: start + token.length };
}

function findSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];
  const skillTokenPattern = /\/[^\s]+ {2}/g;
  let match: RegExpExecArray | null;
  while ((match = skillTokenPattern.exec(value)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function removeSkillToken(value: string, skillName: string): string {
  const range = findSkillTokenRange(value, skillName);
  if (!range) return value;
  return `${value.slice(0, range.start)}${value.slice(range.end)}`;
}

function renderHighlightedComposerText(
  value: string,
  tokenRanges: SkillTokenRange[],
) {
  if (tokenRanges.length === 0) {
    return <>{value}{value.endsWith('\n') ? '\n' : '\u200b'}</>;
  }

  const chunks: React.ReactNode[] = [];
  let cursor = 0;

  for (const tokenRange of tokenRanges) {
    const token = value.slice(tokenRange.start, tokenRange.end);
    const tokenLabel = token.trimEnd();
    const tokenTrailingSpace = token.slice(tokenLabel.length);

    if (tokenRange.start > cursor) {
      chunks.push(value.slice(cursor, tokenRange.start));
    }
    chunks.push(
      <span
        key={`skill-token-${tokenRange.start}`}
        data-testid="chat-composer-skill-token"
        className="rounded-md bg-skill-bg/14 text-skill-fg [-webkit-box-decoration-break:clone] [box-decoration-break:clone] [text-shadow:0_0_10px_rgba(47,107,255,0.38)] dark:bg-skill-bg/18 dark:text-skill-fg-dark dark:[text-shadow:0_0_12px_rgba(37,99,235,0.42)]"
      >
        {tokenLabel}
      </span>,
      tokenTrailingSpace,
    );
    cursor = tokenRange.end;
  }

  if (cursor < value.length) {
    chunks.push(value.slice(cursor));
  }
  chunks.push(value.endsWith('\n') ? '\n' : '\u200b');

  return <>{chunks}</>;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({ onSend, onStop, disabled = false, sending = false, isEmpty = false }: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<QuickAccessSkill | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const filteredQuickSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return quickSkills;
    return quickSkills.filter((skill) =>
      skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query)
      || skill.sourceLabel.toLowerCase().includes(query),
    );
  }, [quickSkills, skillQuery]);
  const showAgentPicker = mentionableAgents.length > 0;
  const chatComposerStatusComponents = rendererExtensionRegistry.getChatComposerStatusComponents();
  const skillTokenRanges = useMemo(() => findSkillTokenRanges(input), [input]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [input]);

  // Focus textarea on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideAgentPicker = pickerRef.current?.contains(target);
      const insideSkillPicker = skillPickerRef.current?.contains(target);
      if (!insideAgentPicker && !insideSkillPicker) {
        setPickerOpen(false);
        setSkillPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [pickerOpen, skillPickerOpen]);

  useEffect(() => {
    setSelectedSkill((prev) => {
      if (prev) {
        setInput((currentInput) => removeSkillToken(currentInput, prev.name));
      }
      return null;
    });
    setSkillPickerOpen(false);
    setSkillQuery('');
    setQuickSkills([]);
    setSkillsError(null);
  }, [currentAgentId]);

  useEffect(() => {
    if (!selectedSkill) return;
    const tokenRange = findSkillTokenRange(input, selectedSkill.name);
    if (!tokenRange) {
      setSelectedSkill(null);
    }
  }, [input, selectedSkill]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const moveCaretTo = useCallback((position: number) => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(position, position);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  }, []);

  const normalizeSelectionAroundSkill = useCallback(() => {
    if (skillTokenRanges.length === 0) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) return;
    const tokenRange = skillTokenRanges.find((range) => selectionStart > range.start && selectionStart < range.end);
    if (tokenRange) {
      moveCaretTo(tokenRange.end);
    }
  }, [moveCaretTo, skillTokenRanges]);

  const loadQuickSkills = useCallback(async () => {
    if (!currentAgent) {
      setQuickSkills([]);
      setSkillsError(null);
      return;
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await hostApiFetch<{
        success: boolean;
        skills?: QuickAccessSkill[];
        error?: string;
      }>('/api/skills/quick-access', {
        method: 'POST',
        body: JSON.stringify({
          workspace: currentAgent.workspace,
          agentDir: currentAgent.agentDir,
        }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      setQuickSkills(result.skills || []);
    } catch (error) {
      setQuickSkills([]);
      setSkillsError(String(error));
    } finally {
      setSkillsLoading(false);
    }
  }, [currentAgent]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    void loadQuickSkills();
  }, [skillPickerOpen, loadQuickSkills]);

  // ── File staging via native dialog ─────────────────────────────

  const pickFiles = useCallback(async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      // Add placeholder entries immediately
      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        // Handle both Unix (/) and Windows (\) path separators
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments(prev => [...prev, {
          id: tempId,
          fileName,
          mimeType: '',
          fileSize: 0,
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        }]);
      }

      // Stage all files via IPC
      console.log('[pickFiles] Staging files:', result.filePaths);
      const staged = await hostApiFetch<Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>>('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: result.filePaths }),
      });
      console.log('[pickFiles] Stage result:', staged?.map(s => ({ id: s?.id, fileName: s?.fileName, mimeType: s?.mimeType, fileSize: s?.fileSize, stagedPath: s?.stagedPath, hasPreview: !!s?.preview })));

      // Update each placeholder with real data
      setAttachments(prev => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      // Mark any stuck 'staging' attachments as 'error' so the user can remove them
      // and the send button isn't permanently blocked
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, []);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
          }),
        });
        console.log(`[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`);
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, status: 'ready' as const } : a,
        ));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0) && allReady && !disabled && !sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;

    if (rendererExtensionRegistry.hasChatBeforeSendHooks()) {
      const guard = await rendererExtensionRegistry.runChatBeforeSend({
        text: textToSend,
        attachments: attachmentsToSend,
        targetAgentId,
      });
      if (!guard.ok) {
        if (guard.message) {
          toast.error(guard.message);
        }
        return;
      }
    }

    // Capture values before clearing — clear input immediately for snappy UX,
    // but keep attachments available for the async send
    console.log(`[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`);
    if (attachmentsToSend) {
      console.log('[handleSend] Attachment details:', attachmentsToSend.map(a => ({
        id: a.id, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize,
        stagedPath: a.stagedPath, status: a.status, hasPreview: !!a.preview,
      })));
    }
    setInput('');
    setAttachments([]);
    setSelectedSkill(null);
    setSkillQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend, targetAgentId);
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
  }, [input, attachments, canSend, onSend, targetAgentId]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace') {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) =>
          selectionStart === selectionEnd
          && selectionStart > range.start
          && selectionStart <= range.end,
        );

        if (
          tokenRange
        ) {
          e.preventDefault();
          const valueWithoutToken = `${input.slice(0, tokenRange.start)}${input.slice(tokenRange.end)}`;
          setInput(valueWithoutToken);
          setSelectedSkill(null);
          moveCaretTo(tokenRange.start);
          return;
        }

        if (!input) {
          if (selectedSkill) {
            setSelectedSkill(null);
            return;
          }
          setTargetAgentId(null);
          return;
        }
      }
      if (e.key === 'ArrowLeft' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.end);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.start);
          return;
        }
      }
      if (e.key === 'ArrowRight' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.start);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.end);
          return;
        }
      }
      if (e.key === 'Escape') {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, input, moveCaretTo, selectedSkill, skillTokenRanges],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [stageBufferFiles],
  );

  return (
    <div
      className={cn(
        "p-4 pb-6 w-full mx-auto transition-all duration-300",
        isEmpty ? "max-w-3xl" : "max-w-4xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Container */}
        <div className={`relative bg-white dark:bg-card rounded-2xl shadow-sm border px-3 pt-2.5 pb-1.5 transition-all ${dragOver ? 'border-primary ring-1 ring-primary' : 'border-black/10 dark:border-white/10'}`}>
          {selectedTarget && (
            <div className="flex flex-wrap gap-2 pb-1.5">
              <button
                type="button"
                onClick={() => setTargetAgentId(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-primary/10"
                title={t('composer.clearTarget')}
              >
                <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Text Row — flush-left */}
          <div className="relative min-h-[48px]">
            {skillTokenRanges.length > 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
              >
                {renderHighlightedComposerText(input, skillTokenRanges)}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onSelect={normalizeSelectionAroundSkill}
              onClick={normalizeSelectionAroundSkill}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={disabled ? t('composer.gatewayDisconnectedPlaceholder') : ''}
              disabled={disabled}
              data-testid="chat-composer-input"
              className={cn(
                "relative z-10 min-h-[48px] max-h-[240px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted-foreground/60",
                skillTokenRanges.length > 0 && "text-transparent caret-foreground selection:bg-primary/20",
              )}
              rows={1}
            />
          </div>

          {/* Action Row — icons on their own line */}
          <div className="mt-1.5 flex items-center gap-1">
            {/* Attach Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              onClick={pickFiles}
              disabled={disabled || sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>

            {showAgentPicker && (
              <div ref={pickerRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-agent"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setPickerOpen((open) => !open);
                  }}
                  disabled={disabled || sending}
                  title={t('composer.pickAgent')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                {pickerOpen && (
                  <div className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card">
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {mentionableAgents.map((agent) => (
                        <AgentPickerItem
                          key={agent.id}
                          agent={agent}
                          selected={agent.id === targetAgentId}
                          onSelect={() => {
                            setTargetAgentId(agent.id);
                            setPickerOpen(false);
                            textareaRef.current?.focus();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={skillPickerRef} className="relative shrink-0">
              <button
                type="button"
                data-testid="chat-composer-skill"
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                  (skillPickerOpen || selectedSkill) && 'text-foreground',
                )}
                onClick={() => {
                  setPickerOpen(false);
                  setSkillPickerOpen((open) => !open);
                }}
                disabled={disabled || sending}
                title={t('composer.pickSkill')}
              >
                <span>{t('composer.skillButton')}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', skillPickerOpen && 'rotate-180')} />
              </button>
              {skillPickerOpen && (
                <div className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card">
                  <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={skillQuery}
                      onChange={(event) => setSkillQuery(event.target.value)}
                      placeholder={t('composer.skillSearchPlaceholder')}
                      className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                      autoFocus
                    />
                  </div>
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.skillPickerTitle', { agent: currentAgentName })}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {skillsLoading ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillLoading')}
                      </div>
                    ) : skillsError ? (
                      <div className="px-3 py-4 text-xs text-destructive">
                        {skillsError}
                      </div>
                    ) : filteredQuickSkills.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillEmpty')}
                      </div>
                    ) : (
                      filteredQuickSkills.map((skill) => (
                        <SkillPickerItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={false}
                          onSelect={() => {
                            const textarea = textareaRef.current;
                            const nextToken = getSkillPrefix(skill.name);
                            const selectionStart = textarea?.selectionStart ?? input.length;
                            const selectionEnd = textarea?.selectionEnd ?? input.length;
                            let nextValue = input;
                            let adjustedStart = selectionStart;
                            let adjustedEnd = selectionEnd;

                            const leadingSpace = needsLeadingSkillSpace(nextValue, adjustedStart) ? ' ' : '';
                            nextValue = `${nextValue.slice(0, adjustedStart)}${leadingSpace}${nextToken}${nextValue.slice(adjustedEnd)}`;
                            setSelectedSkill(null);
                            setInput(nextValue);
                            setSkillPickerOpen(false);
                            setSkillQuery('');
                            requestAnimationFrame(() => {
                              textareaRef.current?.focus();
                              const cursorPosition = adjustedStart + leadingSpace.length + nextToken.length;
                              textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
                            });
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Send Button — pushed to the right */}
            <Button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? !canStop : !canSend}
              size="icon"
              data-testid="chat-composer-send"
              className={`ml-auto shrink-0 h-8 w-8 rounded-lg transition-colors ${
                (sending || canSend)
                  ? 'bg-black/5 dark:bg-white/10 text-foreground hover:bg-black/10 dark:hover:bg-white/20'
                  : 'text-muted-foreground/50 hover:bg-transparent bg-transparent'
              }`}
              variant="ghost"
              title={sending ? t('composer.stop') : t('composer.send')}
            >
              {sending ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-4 w-4" strokeWidth={2} />
              )}
            </Button>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 text-tiny text-muted-foreground/60 px-4">
          <div className="flex items-center gap-1.5">
            <div className={cn("w-1.5 h-1.5 rounded-full", gatewayStatus.state === 'running' ? "bg-green-500/80" : "bg-red-500/80")} />
            <span>
              {t('composer.gatewayStatus', {
                state: gatewayStatus.state === 'running'
                  ? t('composer.gatewayConnected')
                  : gatewayStatus.state,
                port: gatewayStatus.port,
                pid: gatewayStatus.pid ? `| pid: ${gatewayStatus.pid}` : '',
              })}
            </span>
            {chatComposerStatusComponents.map((Component, index) => (
              <Component key={`${index}`} gatewayStatus={gatewayStatus} />
            ))}
          </div>
          {hasFailedAttachments && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-tiny"
              onClick={() => {
                setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                void pickFiles();
              }}
            >
              {t('composer.retryFailedAttachments')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border">
      {isImage ? (
        // Image thumbnail
        <div className="w-16 h-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        // Generic file card
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-2xs text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-2xs text-destructive font-medium px-1">Error</span>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-sm font-medium text-foreground">{agent.name}</span>
      <span className="text-tiny text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}

function SkillPickerItem({
  skill,
  selected,
  onSelect,
}: {
  skill: QuickAccessSkill;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`chat-composer-skill-option-${skill.name}`}
          onClick={onSelect}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors',
            selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-meta font-semibold text-foreground">
              <span className="font-mono">/{skill.name}</span>
            </div>
            <div className="truncate text-tiny text-muted-foreground">
              {skill.sourceLabel}
            </div>
          </div>
          <span className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
            {skill.sourceLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
        {skill.description}
      </TooltipContent>
    </Tooltip>
  );
}
