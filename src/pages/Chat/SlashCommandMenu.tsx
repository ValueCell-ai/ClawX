/**
 * Slash Command Menu
 * Floating popup showing available slash commands above the chat input.
 * Sections: Gateway commands, Local commands, Skill commands.
 */
import { useRef, useEffect, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlashCommand } from './useSlashCommands';

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

export function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
}: SlashCommandMenuProps) {
  const { t } = useTranslation('chat');
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Keep selected item scrolled into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const gateway = commands.filter((c) => c.type === 'gateway');
  const local = commands.filter((c) => c.type === 'local');
  const skills = commands.filter((c) => c.type === 'skill');

  if (commands.length === 0) return null;

  const renderSection = (label: string, items: SlashCommand[]) =>
    items.length > 0 && (
      <>
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </div>
        {items.map((cmd) => {
          const idx = commands.indexOf(cmd);
          return (
            <CommandItem
              key={`${cmd.type}-${cmd.name}`}
              cmd={cmd}
              selected={idx === selectedIndex}
              ref={idx === selectedIndex ? selectedRef : undefined}
              onSelect={onSelect}
            />
          );
        })}
      </>
    );

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
      <div className="rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
        <div className="max-h-[min(300px,50vh)] overflow-y-auto p-1">
          {renderSection(t('slashCommands.commands'), gateway)}
          {renderSection(t('slashCommands.local'), local)}
          {renderSection(t('slashCommands.skills'), skills)}
        </div>

        {/* Keyboard hints */}
        <div className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          {t('slashCommands.keyHints')}
        </div>
      </div>
    </div>
  );
}

// ── Command Item ─────────────────────────────────────────────────

const CommandItem = forwardRef<
  HTMLButtonElement,
  {
    cmd: SlashCommand;
    selected: boolean;
    onSelect: (cmd: SlashCommand) => void;
  }
>(({ cmd, selected, onSelect }, ref) => (
  <button
    ref={ref}
    type="button"
    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
      selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
    }`}
    onMouseDown={(e) => {
      // Use mousedown to fire before textarea blur
      e.preventDefault();
      onSelect(cmd);
    }}
  >
    <span className="w-5 text-center text-base shrink-0">{cmd.icon}</span>
    <span className="font-medium">/{cmd.name}</span>
    <span className="text-muted-foreground truncate">{cmd.description}</span>
  </button>
));

CommandItem.displayName = 'CommandItem';
