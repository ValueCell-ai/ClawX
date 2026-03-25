/**
 * Workspace Page
 * Browse and preview files in agent workspaces
 */
import { useEffect, useState, useCallback } from 'react';
import {
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  FileText,
  Image,
  Code,
  Globe,
  FileQuestion,
  ChevronsUpDown,
  Check,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

interface WorkspaceAgent {
  id: string;
  name: string;
  workspace: string;
  isDefault: boolean;
}

interface FileContent {
  success: boolean;
  fileType: 'text' | 'image' | 'html' | 'binary';
  content?: string;
  language?: string;
  mimeType?: string;
  size?: number;
  message?: string;
  error?: string;
}

// ─── Markdown Renderer ───────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');
  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>');
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">$1</a>');
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return result;
}

function renderMarkdownTable(lines: string[], startIndex: number): { html: string; endIndex: number } {
  const tableLines: string[] = [];
  let i = startIndex;
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    tableLines.push(lines[i].trim());
    i++;
  }
  if (tableLines.length < 2) return { html: '', endIndex: startIndex };

  const parseRow = (line: string) =>
    line.split('|').slice(1, -1).map((cell) => cell.trim());

  const headers = parseRow(tableLines[0]);
  // Skip separator row (index 1)
  const bodyRows = tableLines.slice(2).map(parseRow);

  // Parse alignment from separator row
  const separatorCells = parseRow(tableLines[1]);
  const aligns = separatorCells.map((cell) => {
    const trimmed = cell.replace(/\s/g, '');
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });

  let html = '<div class="overflow-x-auto my-3"><table class="min-w-full border-collapse border border-border text-sm">';
  html += '<thead><tr>';
  headers.forEach((h, idx) => {
    const align = aligns[idx] || 'left';
    html += `<th class="border border-border px-3 py-2 bg-muted/50 font-semibold text-${align}">${renderInlineMarkdown(h)}</th>`;
  });
  html += '</tr></thead><tbody>';
  bodyRows.forEach((row) => {
    html += '<tr>';
    headers.forEach((_, idx) => {
      const align = aligns[idx] || 'left';
      const cell = row[idx] || '';
      html += `<td class="border border-border px-3 py-2 text-${align}">${renderInlineMarkdown(cell)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  return { html, endIndex: i };
}

function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  let html = '';
  let i = 0;
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = '';
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        const highlighted = highlightCode(codeBlockContent.trimEnd(), codeBlockLang);
        html += `<div class="my-3 rounded-lg overflow-hidden border border-border">`;
        if (codeBlockLang) {
          html += `<div class="bg-muted/70 px-3 py-1 text-xs text-muted-foreground font-mono border-b border-border">${escapeHtml(codeBlockLang)}</div>`;
        }
        html += `<pre class="p-3 overflow-x-auto bg-muted/30 text-sm"><code>${highlighted}</code></pre></div>`;
        inCodeBlock = false;
        codeBlockContent = '';
        codeBlockLang = '';
      } else {
        // Close any open list
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      i++;
      continue;
    }

    // Table
    if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().match(/^\|[\s:|-]+\|$/)) {
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      const table = renderMarkdownTable(lines, i);
      if (table.html) {
        html += table.html;
        i = table.endIndex;
        continue;
      }
    }

    // Empty line
    if (!trimmed) {
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      const level = headingMatch[1].length;
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm'];
      const mt = level <= 2 ? 'mt-6' : 'mt-4';
      html += `<h${level} class="${sizes[level - 1]} font-bold ${mt} mb-2">${renderInlineMarkdown(headingMatch[2])}</h${level}>`;
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      html += '<hr class="my-4 border-border" />';
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      let quoteContent = '';
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteContent += lines[i].trim().slice(2) + '\n';
        i++;
      }
      html += `<blockquote class="border-l-4 border-border pl-4 my-3 text-muted-foreground italic">${renderInlineMarkdown(quoteContent.trim())}</blockquote>`;
      continue;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
        html += '<ul class="list-disc pl-6 my-2 space-y-1">';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${renderInlineMarkdown(ulMatch[1])}</li>`;
      i++;
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
        html += '<ol class="list-decimal pl-6 my-2 space-y-1">';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${renderInlineMarkdown(olMatch[1])}</li>`;
      i++;
      continue;
    }

    // Paragraph
    if (inList) {
      html += listType === 'ul' ? '</ul>' : '</ol>';
      inList = false;
    }
    html += `<p class="my-2 leading-relaxed">${renderInlineMarkdown(trimmed)}</p>`;
    i++;
  }

  if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';

  return html;
}

// ─── Code Syntax Highlighter ─────────────────────────────────────────────────

const KEYWORD_STYLES: Record<string, { keywords: string[]; className: string }[]> = {
  python: [
    { keywords: ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'yield', 'lambda', 'pass', 'break', 'continue', 'raise', 'and', 'or', 'not', 'in', 'is', 'async', 'await', 'global', 'nonlocal', 'assert', 'del'], className: 'text-purple-500 dark:text-purple-400' },
    { keywords: ['True', 'False', 'None', 'self', 'cls'], className: 'text-orange-500 dark:text-orange-400' },
    { keywords: ['print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'type', 'isinstance', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'open', 'super', 'property', 'staticmethod', 'classmethod'], className: 'text-cyan-500 dark:text-cyan-400' },
  ],
  javascript: [
    { keywords: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await', 'yield', 'this', 'super', 'static', 'get', 'set'], className: 'text-purple-500 dark:text-purple-400' },
    { keywords: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'], className: 'text-orange-500 dark:text-orange-400' },
    { keywords: ['console', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Map', 'Set', 'JSON', 'Math', 'Date', 'Error', 'RegExp', 'Symbol', 'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'fetch', 'require', 'module', 'exports'], className: 'text-cyan-500 dark:text-cyan-400' },
  ],
  typescript: [
    { keywords: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await', 'yield', 'this', 'super', 'static', 'get', 'set', 'type', 'interface', 'enum', 'namespace', 'declare', 'implements', 'abstract', 'readonly', 'as', 'is', 'keyof', 'infer', 'satisfies'], className: 'text-purple-500 dark:text-purple-400' },
    { keywords: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'void', 'never', 'unknown', 'any', 'string', 'number', 'boolean', 'object', 'symbol', 'bigint'], className: 'text-orange-500 dark:text-orange-400' },
    { keywords: ['console', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Map', 'Set', 'JSON', 'Math', 'Date', 'Error', 'RegExp', 'Symbol', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters'], className: 'text-cyan-500 dark:text-cyan-400' },
  ],
  go: [
    { keywords: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go', 'select', 'chan', 'defer', 'fallthrough', 'goto', 'map', 'struct', 'interface', 'type', 'const', 'var'], className: 'text-purple-500 dark:text-purple-400' },
    { keywords: ['true', 'false', 'nil', 'iota'], className: 'text-orange-500 dark:text-orange-400' },
    { keywords: ['fmt', 'make', 'len', 'cap', 'append', 'copy', 'close', 'delete', 'new', 'panic', 'recover', 'print', 'println', 'error', 'string', 'int', 'float64', 'bool', 'byte', 'rune'], className: 'text-cyan-500 dark:text-cyan-400' },
  ],
  rust: [
    { keywords: ['fn', 'let', 'mut', 'const', 'static', 'pub', 'mod', 'use', 'crate', 'self', 'super', 'struct', 'enum', 'trait', 'impl', 'type', 'where', 'for', 'in', 'loop', 'while', 'if', 'else', 'match', 'return', 'break', 'continue', 'as', 'ref', 'move', 'async', 'await', 'dyn', 'unsafe', 'extern'], className: 'text-purple-500 dark:text-purple-400' },
    { keywords: ['true', 'false', 'Some', 'None', 'Ok', 'Err', 'Self'], className: 'text-orange-500 dark:text-orange-400' },
    { keywords: ['println', 'print', 'format', 'vec', 'String', 'Vec', 'Box', 'Option', 'Result', 'HashMap', 'HashSet', 'Rc', 'Arc', 'Mutex', 'Clone', 'Copy', 'Debug', 'Display', 'Default', 'Iterator', 'From', 'Into'], className: 'text-cyan-500 dark:text-cyan-400' },
  ],
  bash: [
    { keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'in', 'function', 'return', 'local', 'export', 'source', 'alias', 'unalias', 'set', 'unset', 'shift', 'exit', 'trap', 'readonly'], className: 'text-purple-500 dark:text-purple-400' },
    { keywords: ['echo', 'printf', 'read', 'cd', 'pwd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'sed', 'awk', 'find', 'xargs', 'sort', 'uniq', 'wc', 'head', 'tail', 'cut', 'tr', 'tee', 'chmod', 'chown', 'curl', 'wget'], className: 'text-cyan-500 dark:text-cyan-400' },
  ],
};

// Use javascript rules as fallback for unknown languages
function getKeywordRulesForLang(lang: string): typeof KEYWORD_STYLES.python {
  if (lang === 'jsx') return KEYWORD_STYLES.javascript;
  if (lang === 'tsx') return KEYWORD_STYLES.typescript;
  return KEYWORD_STYLES[lang] || KEYWORD_STYLES.javascript;
}

function highlightCode(code: string, language: string): string {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  const rules = getKeywordRulesForLang(language);
  const PH = String.fromCharCode(0);

  return lines.map((line) => {
    // Every highlight pass stores its output as a placeholder token so that
    // subsequent regex passes never see previously-generated HTML attributes.
    const tokens: string[] = [];
    const hold = (html: string) => {
      const idx = tokens.length;
      tokens.push(html);
      return `${PH}T${idx}${PH}`;
    };

    let result = line;

    // 1. Comments — full-line early return
    const commentPatterns = [
      /^(\s*)(\/\/.*)$/,      // //
      /^(\s*)(#.*)$/,         // #
      /^(\s*)(--.*)$/,        // --
    ];
    for (const pattern of commentPatterns) {
      const match = result.match(pattern);
      if (match) {
        return `${match[1]}<span class="text-gray-500 dark:text-gray-500 italic">${match[2]}</span>`;
      }
    }

    // 2. Double-quoted strings → placeholder
    result = result.replace(
      /(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)/g,
      (_, q1, body, q2) => hold(`<span class="text-green-600 dark:text-green-400">${q1 as string}${body as string}${q2 as string}</span>`)
    );

    // 3. Single-quoted strings → placeholder
    result = result.replace(
      /(&#x27;)((?:[^&]|&(?!#x27;))*)(&#x27;)/g,
      (_, q1, body, q2) => hold(`<span class="text-green-600 dark:text-green-400">${q1 as string}${body as string}${q2 as string}</span>`)
    );

    // 4. Numbers → placeholder
    result = result.replace(
      /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi,
      (_, n) => hold(`<span class="text-amber-600 dark:text-amber-400">${n as string}</span>`)
    );

    // 5. Keywords → placeholder
    for (const rule of rules) {
      for (const keyword of rule.keywords) {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
        result = result.replace(regex, (_, kw) => hold(`<span class="${rule.className}">${kw as string}</span>`));
      }
    }

    // 6. Restore all placeholders
    const phRegex = new RegExp(`${PH}T(\\d+)${PH}`, 'g');
    result = result.replace(phRegex, (_, idx) => tokens[Number(idx)]);

    return result;
  }).join('\n');
}

// ─── File Icon Helper ────────────────────────────────────────────────────────

function getFileIcon(name: string) {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  if (['.md', '.txt', '.log'].includes(ext)) return <FileText className="h-4 w-4 text-blue-500" />;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) return <Image className="h-4 w-4 text-green-500" />;
  if (['.html', '.htm'].includes(ext)) return <Globe className="h-4 w-4 text-orange-500" />;
  if (['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.sh', '.php', '.lua', '.r'].includes(ext)) return <Code className="h-4 w-4 text-purple-500" />;
  if (['.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.ini', '.cfg', '.conf', '.env'].includes(ext)) return <FileText className="h-4 w-4 text-yellow-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

// ─── File Tree Component ─────────────────────────────────────────────────────

function FileTreeItem({
  node,
  selectedPath,
  onSelectFile,
  depth = 0,
}: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === 'directory') {
    return (
      <div>
        <button
          className={cn(
            'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/5 transition-colors',
            'text-foreground/80'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <FolderOpen className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/5 transition-colors',
        selectedPath === node.path
          ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium'
          : 'text-foreground/70'
      )}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
      onClick={() => onSelectFile(node.path)}
    >
      {getFileIcon(node.name)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ─── File Preview Component ──────────────────────────────────────────────────

function FilePreview({
  fileContent,
  filePath,
  loading,
}: {
  fileContent: FileContent | null;
  filePath: string | null;
  loading: boolean;
}) {
  const { t } = useTranslation('workspace');

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!filePath || !fileContent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
        <FileQuestion className="h-16 w-16 opacity-20" />
        <p className="text-[15px] font-medium">{t('selectFileToPreview')}</p>
      </div>
    );
  }

  if (fileContent.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
          <span className="text-destructive text-sm font-medium">{fileContent.error}</span>
        </div>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || filePath;

  // Image preview
  if (fileContent.fileType === 'image' && fileContent.content) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-black/10 dark:border-white/10 px-4 py-2.5 text-[13px] text-foreground/60 flex items-center gap-2 shrink-0 bg-black/[0.02] dark:bg-white/[0.02]">
          <Image className="h-4 w-4" />
          <span className="truncate font-medium">{filePath}</span>
          {fileContent.size && (
            <span className="ml-auto text-[12px] shrink-0 text-foreground/40">{formatFileSize(fileContent.size)}</span>
          )}
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center p-8 bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
          <img
            src={fileContent.content}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-xl shadow-md"
          />
        </div>
      </div>
    );
  }

  // HTML preview
  if (fileContent.fileType === 'html' && fileContent.content) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-black/10 dark:border-white/10 px-4 py-2.5 text-[13px] text-foreground/60 flex items-center gap-2 shrink-0 bg-black/[0.02] dark:bg-white/[0.02]">
          <Globe className="h-4 w-4" />
          <span className="truncate font-medium">{filePath}</span>
          {fileContent.size && (
            <span className="ml-auto text-[12px] shrink-0 text-foreground/40">{formatFileSize(fileContent.size)}</span>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          <iframe
            srcDoc={fileContent.content}
            title={fileName}
            className="w-full h-full border-0"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    );
  }

  // Markdown preview
  if (fileContent.fileType === 'text' && fileContent.language === 'markdown' && fileContent.content) {
    const htmlContent = renderMarkdownToHtml(fileContent.content);
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-black/10 dark:border-white/10 px-4 py-2.5 text-[13px] text-foreground/60 flex items-center gap-2 shrink-0 bg-black/[0.02] dark:bg-white/[0.02]">
          <FileText className="h-4 w-4" />
          <span className="truncate font-medium">{filePath}</span>
          {fileContent.size && (
            <span className="ml-auto text-[12px] shrink-0 text-foreground/40">{formatFileSize(fileContent.size)}</span>
          )}
        </div>
        <div
          className="flex-1 overflow-auto px-8 py-6 prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </div>
    );
  }

  // Code / Text preview
  if (fileContent.fileType === 'text' && fileContent.content !== undefined) {
    const lang = fileContent.language || 'plaintext';
    const isCode = lang !== 'plaintext' && lang !== 'markdown';
    const content = fileContent.content;

    if (isCode) {
      const highlighted = highlightCode(content, lang);
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-black/10 dark:border-white/10 px-4 py-2.5 text-[13px] text-foreground/60 flex items-center gap-2 shrink-0 bg-black/[0.02] dark:bg-white/[0.02]">
            <Code className="h-4 w-4" />
            <span className="truncate font-medium">{filePath}</span>
            <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 font-mono text-foreground/50">{lang}</span>
            {fileContent.size && (
              <span className="ml-auto text-[12px] shrink-0 text-foreground/40">{formatFileSize(fileContent.size)}</span>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            <div className="flex text-[13px] font-mono">
              <div className="select-none text-right pr-3 pl-3 py-3 text-foreground/20 border-r border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] leading-[1.65]">
                {content.split('\n').map((_, idx) => (
                  <div key={idx}>{idx + 1}</div>
                ))}
              </div>
              <pre className="flex-1 p-3 overflow-x-auto leading-[1.65]">
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
            </div>
          </div>
        </div>
      );
    }

    // Plain text
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-black/10 dark:border-white/10 px-4 py-2.5 text-[13px] text-foreground/60 flex items-center gap-2 shrink-0 bg-black/[0.02] dark:bg-white/[0.02]">
          <FileText className="h-4 w-4" />
          <span className="truncate font-medium">{filePath}</span>
          {fileContent.size && (
            <span className="ml-auto text-[12px] shrink-0 text-foreground/40">{formatFileSize(fileContent.size)}</span>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          <pre className="p-6 text-[13px] font-mono whitespace-pre-wrap break-words leading-relaxed">{content}</pre>
        </div>
      </div>
    );
  }

  // Binary / unsupported
  if (fileContent.fileType === 'binary') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
        <FileQuestion className="h-16 w-16 opacity-20" />
        <p className="text-[15px] font-medium">{t('binaryNotSupported')}</p>
        {fileContent.size && (
          <p className="text-[12px] text-foreground/40">{formatFileSize(fileContent.size)}</p>
        )}
      </div>
    );
  }

  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Agent Selector ──────────────────────────────────────────────────────────

function AgentSelector({
  agents,
  selectedAgentId,
  onSelect,
}: {
  agents: WorkspaceAgent[];
  selectedAgentId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  if (agents.length <= 1) {
    return (
      <div className="text-[13px] font-medium text-foreground/70 px-2">
        {selectedAgent?.name || selectedAgentId}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-full border border-black/10 dark:border-white/10 bg-transparent px-4 py-1.5 text-[13px] font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-foreground/80"
        onClick={() => setOpen(!open)}
      >
        <span>{selectedAgent?.name || selectedAgentId}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-40 min-w-[280px] max-w-[420px] rounded-xl border border-black/10 dark:border-white/10 bg-[#f3f1e9] dark:bg-card shadow-lg py-1.5 overflow-hidden">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={cn(
                  'flex w-full items-start gap-2 px-3.5 py-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5',
                  agent.id === selectedAgentId && 'bg-black/5 dark:bg-white/10 font-medium'
                )}
                onClick={() => {
                  onSelect(agent.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 mt-0.5',
                    agent.id === selectedAgentId ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span>{agent.name}</span>
                    {agent.isDefault && (
                      <span className="text-[11px] text-foreground/40">default</span>
                    )}
                  </div>
                  <span className="text-[11px] text-foreground/40 font-mono truncate" title={agent.workspace}>
                    {agent.workspace}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Workspace Page ─────────────────────────────────────────────────────

export function Workspace() {
  const { t } = useTranslation('workspace');

  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('main');
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string>('');

  const fetchAgents = useCallback(async () => {
    try {
      const result = await hostApiFetch<{ success: boolean; agents: WorkspaceAgent[] }>('/api/workspace/agents');
      if (result.success && result.agents) {
        setAgents(result.agents);
        const defaultAgent = result.agents.find((a) => a.isDefault) || result.agents[0];
        if (defaultAgent) {
          setSelectedAgentId(defaultAgent.id);
        }
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const fetchTree = useCallback(async (agentId: string) => {
    setTreeLoading(true);
    setError(null);
    try {
      const result = await hostApiFetch<{
        success: boolean;
        tree: FileTreeNode[];
        workspace: string;
        error?: string;
      }>(`/api/workspace/tree?agent=${encodeURIComponent(agentId)}`);
      if (result.success) {
        setFileTree(result.tree);
        setWorkspacePath(result.workspace);
      } else {
        setError(result.error || 'Failed to load workspace');
        setFileTree([]);
      }
    } catch (err) {
      setError(String(err));
      setFileTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const fetchFileContent = useCallback(async (agentId: string, filePath: string) => {
    setFileLoading(true);
    try {
      const result = await hostApiFetch<FileContent>(
        `/api/workspace/file?agent=${encodeURIComponent(agentId)}&path=${encodeURIComponent(filePath)}`
      );
      setFileContent(result);
    } catch (err) {
      setFileContent({ success: false, fileType: 'binary', error: String(err) });
    } finally {
      setFileLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (selectedAgentId) {
      setSelectedFile(null);
      setFileContent(null);
      void fetchTree(selectedAgentId);
    }
  }, [selectedAgentId, fetchTree]);

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
      void fetchFileContent(selectedAgentId, path);
    },
    [selectedAgentId, fetchFileContent],
  );

  const handleRefresh = useCallback(() => {
    void fetchTree(selectedAgentId);
    setSelectedFile(null);
    setFileContent(null);
  }, [selectedAgentId, fetchTree]);

  if (treeLoading && fileTree.length === 0 && !error) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-[1400px] mx-auto flex flex-col h-full p-10 pt-16">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 shrink-0 gap-4">
          <div>
            <h1
              className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight"
              style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
            >
              {t('title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <AgentSelector
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelect={setSelectedAgentId}
            />
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
            {workspacePath && (
              <Button
                variant="outline"
                onClick={async () => {
                  const err = await invokeIpc<string>('shell:openPath', workspacePath);
                  if (err) console.error('Failed to open workspace:', err);
                }}
                className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                {t(window.electron.platform === 'darwin' ? 'revealInFinder' : window.electron.platform === 'win32' ? 'revealInExplorer' : 'revealInFileManager')}
              </Button>
            )}
          </div>
        </div>

        {/* Content - Split Panel */}
        <div className="flex flex-1 overflow-hidden min-h-0 rounded-2xl border border-black/10 dark:border-white/10">
          {/* File Tree Panel */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] py-2 px-1.5">
            {treeLoading ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner size="lg" />
              </div>
            ) : error ? (
              <div className="p-4 text-[13px] text-destructive">{error}</div>
            ) : fileTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <FolderOpen className="h-10 w-10 opacity-20" />
                <p className="text-[13px] font-medium">{t('emptyWorkspace')}</p>
              </div>
            ) : (
              fileTree.map((node) => (
                <FileTreeItem
                  key={node.path}
                  node={node}
                  selectedPath={selectedFile}
                  onSelectFile={handleSelectFile}
                />
              ))
            )}
          </div>

          {/* File Preview Panel */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <FilePreview
              fileContent={fileContent}
              filePath={selectedFile}
              loading={fileLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
