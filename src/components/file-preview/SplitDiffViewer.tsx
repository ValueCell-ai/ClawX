/**
 * GitHub-style side-by-side diff viewer.
 *
 * Layout reference (matches WorkBuddy's `变更` tab):
 *
 *   ┌─ filename                        −N  +M    ⊞ ─┐
 *   ├──────────────────────┬──────────────────────┤
 *   │ 1   …                │ 1   …                │   ← unchanged rows
 *   │ 2   foo (- pink)     │ 2   bar (+ green)    │   ← modified rows
 *   │ 3   baz (- pink)     │     ─                │   ← deletion-only row
 *   │     ─                │ 3   qux (+ green)    │   ← insertion-only row
 *   └──────────────────────┴──────────────────────┘
 *
 * The component is self-contained (no Monaco), so it renders fast even when
 * dropped inside a Sheet, and the visual palette matches GitHub's review
 * page rather than an IDE diff.
 *
 * For files larger than `MAX_LINES` we degrade to a notice and let the user
 * fall back to the source tab — the algorithm is O(n) but rendering tens of
 * thousands of rows would still freeze the renderer.
 */
import { useMemo } from 'react';
import { diffLines, diffWordsWithSpace, type Change } from 'diff';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface SplitDiffViewerProps {
  filePath: string;
  fileName: string;
  original: string | null | undefined;
  modified: string | null | undefined;
  className?: string;
}

const MAX_LINES = 8000;

type RowKind = 'unchanged' | 'removed' | 'added' | 'modified' | 'placeholder';

interface DiffRow {
  kind: RowKind;
  leftNo: number | null;
  rightNo: number | null;
  leftText: string | null;
  rightText: string | null;
}

interface BuildResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  truncated: boolean;
}

function splitToLines(text: string): string[] {
  // Preserve trailing empty lines but drop a trailing newline so we don't
  // emit a phantom blank row at the bottom.
  const value = text ?? '';
  if (value.length === 0) return [];
  const lines = value.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function buildRows(originalText: string, modifiedText: string): BuildResult {
  const originalLines = splitToLines(originalText);
  const modifiedLines = splitToLines(modifiedText);

  const totalEstimate = originalLines.length + modifiedLines.length;
  if (totalEstimate > MAX_LINES * 2) {
    return { rows: [], added: 0, removed: 0, truncated: true };
  }

  const changes: Change[] = diffLines(originalText ?? '', modifiedText ?? '');

  const rows: DiffRow[] = [];
  let leftCounter = 0;
  let rightCounter = 0;
  let added = 0;
  let removed = 0;

  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i];
    const lines = splitToLines(change.value);
    if (lines.length === 0) continue;

    if (change.added) {
      added += lines.length;
      // Try pairing with the immediately preceding removed block as a
      // "modified" pair so the rows line up like GitHub's split view.
      let pairedFromIdx: number | null = null;
      for (let j = rows.length - 1; j >= 0; j -= 1) {
        if (rows[j].kind === 'placeholder') continue;
        if (rows[j].kind === 'removed') {
          pairedFromIdx = j;
        }
        break;
      }
      if (pairedFromIdx != null) {
        // Walk forward over consecutive removed rows and merge with our adds.
        let pairIdx = pairedFromIdx;
        // Find earliest removed row in the trailing block.
        while (pairIdx > 0 && rows[pairIdx - 1].kind === 'removed') {
          pairIdx -= 1;
        }
        for (let k = 0; k < lines.length; k += 1) {
          rightCounter += 1;
          const rowIdx = pairIdx + k;
          if (rowIdx < rows.length && rows[rowIdx].kind === 'removed') {
            rows[rowIdx] = {
              kind: 'modified',
              leftNo: rows[rowIdx].leftNo,
              rightNo: rightCounter,
              leftText: rows[rowIdx].leftText,
              rightText: lines[k],
            };
          } else {
            rows.push({
              kind: 'added',
              leftNo: null,
              rightNo: rightCounter,
              leftText: null,
              rightText: lines[k],
            });
          }
        }
      } else {
        for (const line of lines) {
          rightCounter += 1;
          rows.push({
            kind: 'added',
            leftNo: null,
            rightNo: rightCounter,
            leftText: null,
            rightText: line,
          });
        }
      }
    } else if (change.removed) {
      removed += lines.length;
      for (const line of lines) {
        leftCounter += 1;
        rows.push({
          kind: 'removed',
          leftNo: leftCounter,
          rightNo: null,
          leftText: line,
          rightText: null,
        });
      }
    } else {
      for (const line of lines) {
        leftCounter += 1;
        rightCounter += 1;
        rows.push({
          kind: 'unchanged',
          leftNo: leftCounter,
          rightNo: rightCounter,
          leftText: line,
          rightText: line,
        });
      }
    }
  }

  return { rows, added, removed, truncated: false };
}

interface WordSpan {
  value: string;
  highlighted: boolean;
}

function wordDiff(left: string, right: string, side: 'left' | 'right'): WordSpan[] {
  // Skip word-level diff for very long lines — keeps the row from blocking
  // the main thread when the file has 10k-char minified bundles.
  if (left.length > 1000 || right.length > 1000) {
    return [{ value: side === 'left' ? left : right, highlighted: true }];
  }
  const parts = diffWordsWithSpace(left ?? '', right ?? '');
  const spans: WordSpan[] = [];
  for (const part of parts) {
    if (side === 'left') {
      if (part.added) continue;
      spans.push({ value: part.value, highlighted: !!part.removed });
    } else {
      if (part.removed) continue;
      spans.push({ value: part.value, highlighted: !!part.added });
    }
  }
  return spans;
}

export default function SplitDiffViewer({
  filePath: _filePath,
  fileName,
  original,
  modified,
  className,
}: SplitDiffViewerProps) {
  const { t } = useTranslation('chat');

  const result = useMemo<BuildResult>(() => {
    if (original == null && modified == null) {
      return { rows: [], added: 0, removed: 0, truncated: false };
    }
    return buildRows(original ?? '', modified ?? '');
  }, [original, modified]);

  if (original == null && modified == null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('filePreview.diff.noChanges', '没有可显示的变更')}
      </div>
    );
  }

  if (original == null) {
    return (
      <div className="flex h-full flex-col">
        <DiffHeader fileName={fileName} added={0} removed={0} isNewFile />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('filePreview.diff.newFile', '这是新增文件，无对比内容')}
        </div>
      </div>
    );
  }

  if (result.truncated) {
    return (
      <div className="flex h-full flex-col">
        <DiffHeader fileName={fileName} added={0} removed={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {t('filePreview.diff.tooLarge', '文件过大，已禁用 diff 视图，请到「源码」标签查看完整内容')}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      <DiffHeader fileName={fileName} added={result.added} removed={result.removed} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse font-mono text-xs leading-relaxed">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-10" />
            <col />
          </colgroup>
          <tbody>
            {result.rows.map((row, idx) => (
              <DiffRowView key={idx} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface DiffHeaderProps {
  fileName: string;
  added: number;
  removed: number;
  isNewFile?: boolean;
}

function DiffHeader({ fileName, added, removed, isNewFile }: DiffHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-black/5 bg-card/40 px-4 py-2 text-xs dark:border-white/10">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary/70" />
        <span className="truncate font-mono text-foreground/90">{fileName}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-rose-600 dark:text-rose-400">−{removed}</span>
        <span className="font-mono text-emerald-600 dark:text-emerald-400">+{added}</span>
        {isNewFile && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-2xs font-medium text-emerald-700 dark:text-emerald-300">
            new
          </span>
        )}
      </div>
    </div>
  );
}

interface DiffRowViewProps {
  row: DiffRow;
}

function DiffRowView({ row }: DiffRowViewProps) {
  const leftCellClass = cn(
    'whitespace-pre-wrap break-all align-top px-2 py-0.5',
    row.kind === 'removed' && 'bg-rose-50 dark:bg-rose-950/30',
    row.kind === 'modified' && 'bg-rose-50 dark:bg-rose-950/30',
    row.kind === 'added' && 'bg-rose-50/30 dark:bg-rose-950/10',
  );
  const rightCellClass = cn(
    'whitespace-pre-wrap break-all align-top px-2 py-0.5',
    row.kind === 'added' && 'bg-emerald-50 dark:bg-emerald-950/30',
    row.kind === 'modified' && 'bg-emerald-50 dark:bg-emerald-950/30',
    row.kind === 'removed' && 'bg-emerald-50/30 dark:bg-emerald-950/10',
  );
  const leftGutterClass = cn(
    'select-none align-top px-2 py-0.5 text-right text-muted-foreground/80',
    'border-l-2',
    row.kind === 'removed' || row.kind === 'modified'
      ? 'border-rose-500/70 bg-rose-50 dark:bg-rose-950/30'
      : 'border-transparent',
  );
  const rightGutterClass = cn(
    'select-none align-top px-2 py-0.5 text-right text-muted-foreground/80',
    'border-l-2',
    row.kind === 'added' || row.kind === 'modified'
      ? 'border-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/30'
      : 'border-transparent',
  );

  // Render content with word-level diff for modified rows; plain text otherwise.
  let leftContent: React.ReactNode;
  let rightContent: React.ReactNode;

  if (row.kind === 'modified' && row.leftText != null && row.rightText != null) {
    const leftSpans = wordDiff(row.leftText, row.rightText, 'left');
    const rightSpans = wordDiff(row.leftText, row.rightText, 'right');
    leftContent = (
      <>
        {leftSpans.map((span, i) => (
          <span
            key={i}
            className={span.highlighted ? 'bg-rose-200/70 dark:bg-rose-700/40' : undefined}
          >
            {span.value}
          </span>
        ))}
      </>
    );
    rightContent = (
      <>
        {rightSpans.map((span, i) => (
          <span
            key={i}
            className={span.highlighted ? 'bg-emerald-200/70 dark:bg-emerald-700/40' : undefined}
          >
            {span.value}
          </span>
        ))}
      </>
    );
  } else {
    leftContent = row.leftText ?? '';
    rightContent = row.rightText ?? '';
  }

  return (
    <tr>
      <td className={leftGutterClass}>{row.leftNo ?? ''}</td>
      <td className={leftCellClass}>{leftContent || '\u00A0'}</td>
      <td className={rightGutterClass}>{row.rightNo ?? ''}</td>
      <td className={rightCellClass}>{rightContent || '\u00A0'}</td>
    </tr>
  );
}
