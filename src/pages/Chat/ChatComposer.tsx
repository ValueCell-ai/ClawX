import { useMemo, useRef, useState } from 'react';
import { SendHorizontal, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ComposerSkill = {
  name: string;
  description?: string;
};

type ChatComposerProps = {
  disabled: boolean;
  sending: boolean;
  skills?: ComposerSkill[];
  onSend: (text: string) => void;
  onStop: () => void;
};

const BASE_COMMANDS = [
  '/help',
  '/new',
  '/reset',
  '/clear',
  '/compact',
  '/model',
  '/think',
  '/verbose',
  '/agents',
];

export function ChatComposer({
  disabled,
  sending,
  skills = [],
  onSend,
  onStop,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const slashOpen = text.trimStart().startsWith('/');
  const slashItems = useMemo(() => {
    const skillItems = skills.map((skill) => `/skill ${skill.name}`);
    return [...BASE_COMMANDS, ...skillItems];
  }, [skills]);

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
  };

  return (
    <div className="border-t border-border bg-surface-input p-3">
      <div className="relative mx-auto flex max-w-4xl items-end gap-2">
        {slashOpen ? (
          <div
            role="listbox"
            aria-label={t('composer.slashCommands')}
            className="absolute bottom-full left-0 mb-2 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface-modal shadow-lg"
          >
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
              {t('composer.slashSkillsHeading')}
            </div>
            {slashItems.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setText(`${item} `);
                  inputRef.current?.focus();
                }}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          data-testid="chat-composer-input"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="min-h-11 flex-1 resize-none rounded-md border border-border bg-surface-input px-3 py-2 text-sm text-foreground"
        />
        <button
          type="button"
          data-testid="chat-composer-send"
          aria-label={sending ? t('composer.stop') : t('composer.send')}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface-input text-foreground hover:bg-black/5 dark:hover:bg-white/10"
          onClick={sending ? onStop : submit}
        >
          {sending ? <Square className="h-4 w-4" /> : <SendHorizontal className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
