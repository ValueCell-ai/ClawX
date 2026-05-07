/**
 * Inline spreadsheet viewer (SheetJS / xlsx).
 *
 * Parses .xlsx / .xls / .csv files via SheetJS's `read()` and renders
 * each sheet as a virtualised HTML table.  The component is read-only;
 * editing flows back to the host app via "open with system app".
 *
 * Loaded lazily (~700 KB minified) so the chat surface stays light.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { readBinaryFile } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const SHEET_MAX_BYTES = 50 * 1024 * 1024;
const ROWS_PER_PAGE = 200;

export interface SheetViewerProps {
  filePath: string;
  fileName?: string;
  className?: string;
}

interface SheetSnapshot {
  name: string;
  rows: string[][];
  columnLetters: string[];
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'tooLarge'; size?: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; sheets: SheetSnapshot[] };

function colLetter(index: number): string {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function formatCellValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

export default function SheetViewer({ filePath, fileName, className }: SheetViewerProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [page, setPage] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setSheetIndex(0);
    setPage(0);

    void (async () => {
      try {
        const res = await readBinaryFile(filePath, { maxBytes: SHEET_MAX_BYTES });
        if (cancelled) return;
        if (!res.ok || !res.data) {
          if (res.error === 'tooLarge') {
            setState({ status: 'tooLarge', size: res.size });
            return;
          }
          setState({ status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        const xlsx = await import('xlsx');
        const wb = xlsx.read(res.data, { type: 'array', cellDates: true });
        const sheets: SheetSnapshot[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          if (!ws) {
            return { name, rows: [], columnLetters: [] };
          }
          const aoa = xlsx.utils.sheet_to_json<Array<unknown>>(ws, {
            header: 1,
            defval: '',
            blankrows: false,
            raw: true,
          });
          let maxCols = 0;
          for (const row of aoa) {
            if (Array.isArray(row) && row.length > maxCols) maxCols = row.length;
          }
          const columnLetters: string[] = [];
          for (let i = 0; i < maxCols; i += 1) columnLetters.push(colLetter(i));
          const rows: string[][] = aoa.map((row) => {
            const out = new Array<string>(maxCols).fill('');
            if (!Array.isArray(row)) return out;
            for (let i = 0; i < maxCols; i += 1) {
              out[i] = formatCellValue(row[i]);
            }
            return out;
          });
          return { name, rows, columnLetters };
        });
        if (cancelled) return;
        setState({ status: 'ready', sheets });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const activeSheet = state.status === 'ready' ? state.sheets[sheetIndex] : null;
  const totalRows = activeSheet?.rows.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));
  const startRow = page * ROWS_PER_PAGE;
  const visibleRows = activeSheet ? activeSheet.rows.slice(startRow, startRow + ROWS_PER_PAGE) : [];

  const handleSelectSheet = useCallback((idx: number) => {
    setSheetIndex(idx);
    setPage(0);
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: 0, left: 0 });
    });
  }, []);

  const handlePrev = useCallback(() => setPage((p) => Math.max(0, p - 1)), []);
  const handleNext = useCallback(
    () => setPage((p) => Math.min(totalPages - 1, p + 1)),
    [totalPages],
  );

  const sheetTabs = useMemo(() => {
    if (state.status !== 'ready') return null;
    return state.sheets.map((sheet, idx) => (
      <button
        key={`${sheet.name}-${idx}`}
        type="button"
        onClick={() => handleSelectSheet(idx)}
        className={cn(
          'shrink-0 truncate border-r border-black/10 px-3 py-1 text-xs transition-colors dark:border-white/10',
          idx === sheetIndex
            ? 'bg-background font-medium text-foreground'
            : 'bg-black/5 text-muted-foreground hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10',
        )}
        title={sheet.name}
        style={{ maxWidth: 220 }}
      >
        {sheet.name || t('filePreview.sheet.unnamedSheet', { defaultValue: 'Sheet {{idx}}', idx: idx + 1 })}
      </button>
    ));
  }, [state, sheetIndex, handleSelectSheet, t]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <LoadingSpinner />
      </div>
    );
  }
  if (state.status === 'tooLarge') {
    return (
      <div className={cn('flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground', className)}>
        {t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-destructive', className)}>
        <p>{t('filePreview.sheet.loadFailed', { defaultValue: 'Spreadsheet failed to load: {{error}}', error: state.message })}</p>
      </div>
    );
  }

  if (!activeSheet) {
    return (
      <div className={cn('flex h-full items-center justify-center text-sm text-muted-foreground', className)}>
        {t('filePreview.sheet.empty', { defaultValue: 'This file has no sheets to display' })}
      </div>
    );
  }

  const isEmpty = activeSheet.rows.length === 0 || activeSheet.columnLetters.length === 0;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)} aria-label={fileName}>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t('filePreview.sheet.emptySheet', { defaultValue: 'This sheet is empty' })}
          </div>
        ) : (
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr>
                <th
                  className="sticky left-0 z-20 border-b border-r border-black/10 bg-muted/80 px-2 py-1 text-center text-2xs text-muted-foreground dark:border-white/10"
                  style={{ width: 48, minWidth: 48 }}
                />
                {activeSheet.columnLetters.map((letter, idx) => (
                  <th
                    key={letter + idx}
                    className="border-b border-r border-black/10 bg-muted/80 px-2 py-1 text-center text-2xs font-medium text-muted-foreground dark:border-white/10"
                    style={{ minWidth: 96 }}
                  >
                    {letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {visibleRows.map((row, rowIdx) => {
                const realIdx = startRow + rowIdx;
                const isHeaderRow = realIdx === 0;
                return (
                  <tr key={realIdx} className={isHeaderRow ? 'bg-primary/5 font-semibold' : undefined}>
                    <td
                      className="sticky left-0 z-10 border-b border-r border-black/10 bg-background px-2 py-1 text-center text-2xs text-muted-foreground dark:border-white/10"
                      style={{ width: 48, minWidth: 48 }}
                    >
                      {realIdx + 1}
                    </td>
                    {row.map((cell, colIdx) => (
                      <td
                        key={colIdx}
                        className="max-w-[420px] truncate border-b border-r border-black/5 px-2 py-1 align-top dark:border-white/5"
                        title={cell.length > 80 ? cell : undefined}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex shrink-0 items-stretch justify-between gap-2 border-t border-black/10 bg-muted/40 dark:border-white/10">
        <div className="flex min-w-0 items-stretch overflow-x-auto">{sheetTabs}</div>
        {totalPages > 1 && (
          <div className="flex shrink-0 items-center gap-1 border-l border-black/10 px-2 text-xs text-muted-foreground dark:border-white/10">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handlePrev}
              disabled={page <= 0}
              title={t('filePreview.sheet.prevPage', 'Previous page')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="tabular-nums">
              {t('filePreview.sheet.rowRange', {
                defaultValue: 'Rows {{from}}-{{to}} / {{total}}',
                from: startRow + 1,
                to: Math.min(totalRows, startRow + ROWS_PER_PAGE),
                total: totalRows,
              })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleNext}
              disabled={page >= totalPages - 1}
              title={t('filePreview.sheet.nextPage', 'Next page')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
