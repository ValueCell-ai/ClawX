export function menuOptionStateClass(selected: boolean): string {
  return selected
    ? 'bg-primary/10 text-foreground'
    : 'hover:bg-black/5 dark:hover:bg-white/5';
}
