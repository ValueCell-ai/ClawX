/**
 * Slash Command Hook
 * Manages slash command menu state, filtering, keyboard navigation,
 * and command execution for the chat input.
 *
 * Three command sources:
 * 1. Gateway commands — parsed from openclaw's slash-commands.md via IPC, sent as chat messages
 * 2. Local commands — handled client-side only (clear, skills list)
 * 3. Skill commands — enabled skills from the skills store
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '@/stores/skills';
import { useChatStore } from '@/stores/chat';

// ── Types ────────────────────────────────────────────────────────

export type CommandType = 'gateway' | 'local' | 'skill';

export interface SlashCommand {
  name: string;
  description: string;
  icon: string;
  type: CommandType;
  acceptsArgs?: boolean;
}

interface SlashCommandsResult {
  isOpen: boolean;
  filteredCommands: SlashCommand[];
  selectedIndex: number;
  handleInputChange: (value: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  selectCommand: (cmd: SlashCommand) => void;
  close: () => void;
}

// ── Icon map for well-known gateway commands ─────────────────────

const COMMAND_ICONS: Record<string, string> = {
  help: '❓',
  commands: '📋',
  status: '📊',
  new: '✨',
  reset: '✨',
  stop: '⏹️',
  model: '🤖',
  models: '🤖',
  think: '🧠',
  thinking: '🧠',
  context: '📐',
  usage: '📈',
  verbose: '📝',
  reasoning: '💭',
  elevated: '🔓',
  exec: '⚙️',
  skill: '🧩',
  whoami: '🪪',
  id: '🪪',
  export: '📤',
  compact: '🗜️',
  subagents: '🤝',
  kill: '💀',
  steer: '🎯',
  tell: '🎯',
  queue: '📬',
  tts: '🔊',
  voice: '🔊',
  allowlist: '🛡️',
  send: '📨',
  activation: '👂',
  restart: '🔄',
  bash: '💻',
  config: '⚙️',
  debug: '🐛',
  approve: '✅',
  dock_telegram: '📱',
  dock_discord: '💬',
  dock_slack: '💬',
};

// ── Singleton cache for gateway commands ─────────────────────────

let _gatewayCommandsCache: SlashCommand[] | null = null;
let _fetchPromise: Promise<SlashCommand[]> | null = null;

function fetchGatewayCommands(): Promise<SlashCommand[]> {
  if (_gatewayCommandsCache) return Promise.resolve(_gatewayCommandsCache);
  if (_fetchPromise) return _fetchPromise;

  type IpcCommandsResponse = {
    success: boolean;
    commands?: Array<{ name: string; description: string; acceptsArgs: boolean }>;
    error?: string;
  };

  _fetchPromise = window.electron.ipcRenderer
    .invoke('openclaw:getSlashCommands')
    .then((raw: unknown) => {
      const result = raw as IpcCommandsResponse;
      if (result.success && result.commands) {
        _gatewayCommandsCache = result.commands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          icon: COMMAND_ICONS[cmd.name] || '▸',
          type: 'gateway' as const,
          acceptsArgs: cmd.acceptsArgs,
        }));
      } else {
        _gatewayCommandsCache = [];
      }
      _fetchPromise = null;
      return _gatewayCommandsCache;
    })
    .catch(() => {
      _gatewayCommandsCache = [];
      _fetchPromise = null;
      return _gatewayCommandsCache;
    });

  return _fetchPromise;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useSlashCommands(
  setInput: (value: string) => void,
  onSend?: (text: string) => void,
): SlashCommandsResult {
  const { t } = useTranslation('chat');
  const skills = useSkillsStore((s) => s.skills);
  const newSession = useChatStore((s) => s.newSession);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [gatewayCommands, setGatewayCommands] = useState<SlashCommand[]>(
    () => _gatewayCommandsCache || [],
  );

  // Fetch gateway commands once on mount
  useEffect(() => {
    fetchGatewayCommands().then(setGatewayCommands);
  }, []);

  // Local-only commands (handled client-side, not sent to Gateway)
  const localCommands: SlashCommand[] = useMemo(
    () => [
      {
        name: t('slashCommands.clear.name'),
        description: t('slashCommands.clear.description'),
        icon: '🧹',
        type: 'local' as const,
      },
      {
        name: t('slashCommands.skillsList.name'),
        description: t('slashCommands.skillsList.description'),
        icon: '🧩',
        type: 'local' as const,
      },
    ],
    [t],
  );

  // Skill commands from enabled skills
  const skillCommands: SlashCommand[] = useMemo(
    () =>
      skills
        .filter((s) => s.enabled)
        .map((s) => ({
          name: s.slug || s.id,
          description: s.description || s.name,
          icon: s.icon || '📦',
          type: 'skill' as const,
        })),
    [skills],
  );

  const allCommands = useMemo(
    () => [...gatewayCommands, ...localCommands, ...skillCommands],
    [gatewayCommands, localCommands, skillCommands],
  );

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!query) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  // ── Execute local command ─────────────────────────────────────

  const executeLocal = useCallback(
    (name: string) => {
      switch (name) {
        case 'clear':
          newSession();
          break;
        case 'skills': {
          const enabledSkills = skills.filter((s) => s.enabled);
          const text =
            enabledSkills.length > 0
              ? `${t('slashCommands.skillsListTitle')}\n${enabledSkills.map((s) => `- ${s.icon || '📦'} **${s.name}** — ${s.description}`).join('\n')}`
              : t('slashCommands.noSkills');
          useChatStore.setState((s) => ({
            messages: [
              ...s.messages,
              {
                role: 'assistant' as const,
                content: text,
                timestamp: Date.now(),
                id: `local-skills-${Date.now()}`,
              },
            ],
          }));
          break;
        }
      }
    },
    [t, newSession, skills],
  );

  // ── Public API ────────────────────────────────────────────────

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      if (value.startsWith('/')) {
        const afterSlash = value.slice(1);
        if (!afterSlash.includes(' ')) {
          setIsOpen(true);
          setQuery(afterSlash);
          setSelectedIndex(0);
          return;
        }
      }
      if (isOpen) {
        close();
      }
    },
    [isOpen, close],
  );

  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.type === 'local') {
        setInput('');
        executeLocal(cmd.name);
      } else if (cmd.type === 'gateway') {
        if (cmd.acceptsArgs) {
          setInput(`/${cmd.name} `);
        } else {
          setInput('');
          onSend?.(`/${cmd.name}`);
        }
      } else {
        setInput(`/${cmd.name} `);
      }
      close();
    },
    [setInput, executeLocal, onSend, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || filteredCommands.length === 0) return false;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev <= 0 ? filteredCommands.length - 1 : prev - 1,
          );
          return true;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev >= filteredCommands.length - 1 ? 0 : prev + 1,
          );
          return true;

        case 'Tab':
        case 'Enter':
          e.preventDefault();
          selectCommand(filteredCommands[selectedIndex]);
          return true;

        case 'Escape':
          e.preventDefault();
          close();
          return true;

        default:
          return false;
      }
    },
    [isOpen, filteredCommands, selectedIndex, selectCommand, close],
  );

  return {
    isOpen,
    filteredCommands,
    selectedIndex,
    handleInputChange,
    handleKeyDown,
    selectCommand,
    close,
  };
}
