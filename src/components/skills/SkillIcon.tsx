import { FileScan, FileText, Mail, Monitor, Presentation, Puzzle, Table2, WandSparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type IconStyle = { icon: LucideIcon; tone: string };

const skillIcons = new Map<string, IconStyle>([
  ['docx', { icon: FileText, tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' }],
  ['xlsx', { icon: Table2, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }],
  ['pptx', { icon: Presentation, tone: 'bg-orange-500/10 text-orange-700 dark:text-orange-400' }],
  ['pdf', { icon: FileScan, tone: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' }],
  ['computer-use', { icon: Monitor, tone: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' }],
  ['skill-creator', { icon: WandSparkles, tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-400' }],
  ['ews-mail', { icon: Mail, tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' }],
]);

const defaultIcon = { icon: Puzzle, tone: 'bg-surface-input text-muted-foreground' };

export function SkillIcon({ name, size = 'menu' }: { name: string; size?: 'menu' | 'shortcut' }) {
  const { icon: Icon, tone } = skillIcons.get(name) ?? defaultIcon;
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center', size === 'shortcut' ? 'size-5 rounded-md' : 'size-7 rounded-lg', tone)}
    >
      <Icon className={size === 'shortcut' ? 'size-3.5' : 'size-4'} />
    </span>
  );
}
