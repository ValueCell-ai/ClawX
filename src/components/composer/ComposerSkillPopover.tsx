import { useEffect, useId, useMemo, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type RefObject } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QuickSkillOption } from '@/components/skills/QuickSkillOption';
import { Input } from '@/components/ui/input';
import { PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { filterQuickAccessSkills } from '@/lib/skill-source-label';
import { cn } from '@/lib/utils';
import type { QuickAccessSkill } from '@/types/skill';

type VirtualAnchor = NonNullable<ComponentPropsWithoutRef<typeof PopoverAnchor>['virtualRef']>;
const emptyAnchor = { getBoundingClientRect: () => new DOMRect() };

type SkillOptions = {
  skills: QuickAccessSkill[];
  skillsLoading?: boolean;
  skillsError?: string | null;
  optionTestIdPrefix: string;
  onSelectSkill(skill: QuickAccessSkill): void;
};

type SkillListNavigation = {
  listId: string;
  activeIndex: number;
  onActiveIndexChange(index: number): void;
};

type Props = Omit<ComponentPropsWithoutRef<typeof PopoverContent>, 'children' | 'side' | 'align' | 'sideOffset' | 'className'> & SkillOptions & {
  composerRef?: RefObject<HTMLElement | null>;
  caretAnchor?: VirtualAnchor;
  navigation?: SkillListNavigation;
};

function SkillResults({
  skills, skillsLoading, skillsError, optionTestIdPrefix, onSelectSkill, navigation, composer,
}: SkillOptions & { navigation: SkillListNavigation; composer: boolean }) {
  const { t } = useTranslation('chat');
  const listRef = useRef<HTMLDivElement>(null);
  const { listId, activeIndex, onActiveIndexChange } = navigation;
  const status = skillsLoading
    ? t('composer.skillLoading')
    : skillsError || (skills.length === 0 ? t('composer.skillEmpty') : null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, skills, status]);

  return (
    <>
      <div
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label={t('composer.pickSkill')}
        aria-busy={skillsLoading || undefined}
        className={cn('clawx-menu-list min-h-0 overflow-y-auto overscroll-contain', composer && 'motion-safe:scroll-smooth')}
        onMouseDown={event => event.preventDefault()}
      >
        {!status && skills.map((skill, index) => (
          <QuickSkillOption
            key={`${skill.source}:${skill.name}:${skill.manifestPath}`}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={activeIndex === index}
            tabIndex={-1}
            data-active={activeIndex === index}
            onMouseMove={() => onActiveIndexChange(index)}
            testId={`${optionTestIdPrefix}-${skill.name}`}
            skill={skill}
            selected={activeIndex === index}
            variant={composer ? 'composer' : 'menu'}
            onSelect={() => onSelectSkill(skill)}
          />
        ))}
      </div>
      {status && (
        <div role="status" className={cn('px-3 py-4 text-sm', !skillsLoading && skillsError ? 'text-destructive' : 'text-muted-foreground')}>
          {status}
        </div>
      )}
    </>
  );
}

function SearchableSkillResults({ composer, ...options }: SkillOptions & { composer: boolean }) {
  const { t } = useTranslation(['chat', 'skills']);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [index, setActiveIndex] = useState(0);
  const matches = useMemo(() => filterQuickAccessSkills(options.skills, query, t), [options.skills, query, t]);
  const activeIndex = matches[index] ? index : 0;
  const activeSkill = !options.skillsLoading && !options.skillsError ? matches[activeIndex] : undefined;
  const searchLabel = t('composer.skillSearchPlaceholder');

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (activeSkill) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((activeIndex + step + matches.length) % matches.length);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeSkill) options.onSelectSkill(activeSkill);
    }
  }

  return (
    <>
      <div className="relative mb-1 shrink-0 border-b border-border/70 pb-1.5">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2 size-4 text-muted-foreground" />
        <Input
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeSkill ? `${listId}-${activeIndex}` : undefined}
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleSearchKeyDown}
          aria-label={searchLabel}
          placeholder={searchLabel}
          className="h-8 rounded-lg border-transparent bg-transparent py-0 pl-9 focus-visible:border-foreground/20 focus-visible:bg-surface-input/50 focus-visible:ring-0"
          autoFocus
        />
      </div>
      <SkillResults {...options} skills={matches} navigation={{ listId, activeIndex, onActiveIndexChange: setActiveIndex }} composer={composer} />
    </>
  );
}

export function ComposerSkillPopoverContent({
  composerRef, caretAnchor, skills, skillsLoading, skillsError, optionTestIdPrefix, navigation, onSelectSkill, ...props
}: Props) {
  const anchor = useMemo(() => ({
    get current() {
      return composerRef?.current ?? caretAnchor?.current ?? emptyAnchor;
    },
  }), [composerRef, caretAnchor]);
  const options = { skills, skillsLoading, skillsError, optionTestIdPrefix, onSelectSkill };

  return (
    <>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        {...props}
        side="top"
        align="start"
        sideOffset={composerRef ? 4 : 8}
        className={cn(
          'flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-modal p-1.5',
          composerRef
            ? 'max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] shadow-lg'
            : 'max-h-[min(320px,var(--radix-popover-content-available-height))] w-96 shadow-xl',
        )}
      >
        {navigation
          ? <SkillResults {...options} navigation={navigation} composer={!!composerRef} />
          : <SearchableSkillResults {...options} composer={!!composerRef} />}
      </PopoverContent>
    </>
  );
}
