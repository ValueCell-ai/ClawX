/**
 * Memory Page
 * Browse and manage AI agent memory (MEMORY.md and daily logs)
 */
import { useEffect, useState } from 'react';
import {
  Brain,
  FileText,
  Calendar,
  Search,
  RefreshCw,
  Clock,
  HardDrive,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';

interface MemoryFile {
  path: string;
  name: string;
  size: number;
  lastModified: string;
  type: 'long-term' | 'daily';
}

interface MemoryStats {
  totalFiles: number;
  totalSize: number;
  longTermSize: number;
  dailyLogCount: number;
  oldestLog?: string;
  newestLog?: string;
}

export function Memory() {
  const { t } = useTranslation('memory');
  const [loading, setLoading] = useState(true);
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [longTermMemory, setLongTermMemory] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchMemoryFiles();
  }, []);

  const fetchMemoryFiles = async () => {
    setLoading(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('memory:list');
      if (result.success) {
        setMemoryFiles(result.files || []);
        setStats(result.stats || null);
        // Load MEMORY.md content
        if (result.longTermMemory) {
          setLongTermMemory(result.longTermMemory);
        }
      }
    } catch (error) {
      console.error('Failed to fetch memory files:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (path: string) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('memory:get', path);
      if (result.success) {
        setFileContent(result.content || '');
        setSelectedFile(path);
      }
    } catch (error) {
      console.error('Failed to load file content:', error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Filter files by search query
  const filteredFiles = memoryFiles.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group files by type
  const longTermFiles = filteredFiles.filter(f => f.type === 'long-term');
  const dailyFiles = filteredFiles.filter(f => f.type === 'daily').sort((a, b) =>
    b.name.localeCompare(a.name)
  ); // Sort by date descending

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left sidebar - File list */}
      <div className="w-80 border-r bg-muted/30 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-5 w-5" />
            <h2 className="font-semibold">{t('title')}</h2>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="p-3 border-b bg-muted/50 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                <span>{stats.totalFiles} {t('files')}</span>
              </div>
              <div className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                <span>{formatSize(stats.totalSize)}</span>
              </div>
            </div>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-auto">
          {/* Long-term memory section */}
          {longTermFiles.length > 0 && (
            <div className="p-2">
              <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
                <Brain className="h-3 w-3" />
                {t('longTermMemory')}
              </div>
              {longTermFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => loadFileContent(file.path)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-left hover:bg-accent transition-colors ${
                    selectedFile === file.path ? 'bg-accent' : ''
                  }`}
                >
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatSize(file.size)} · {formatDate(file.lastModified)}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {/* Daily logs section */}
          {dailyFiles.length > 0 && (
            <div className="p-2">
              <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
                <Calendar className="h-3 w-3" />
                {t('dailyLogs')} ({dailyFiles.length})
              </div>
              {dailyFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => loadFileContent(file.path)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-left hover:bg-accent transition-colors ${
                    selectedFile === file.path ? 'bg-accent' : ''
                  }`}
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{file.name.replace('.md', '')}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatSize(file.size)}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {filteredFiles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">{t('noMemoryFiles')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Right content - File viewer */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            {/* File header */}
            <div className="p-4 border-b bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  <h3 className="font-semibold">{selectedFile.split('/').pop()?.split('\\').pop()}</h3>
                </div>
                <Button variant="outline" size="sm" onClick={fetchMemoryFiles}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('refresh')}
                </Button>
              </div>
            </div>

            {/* File content */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/50 p-4 rounded-lg">
                {fileContent || t('emptyFile')}
              </pre>
            </div>
          </>
        ) : (
          /* Default view - Overview */
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Header */}
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Brain className="h-6 w-6" />
                  {t('overview')}
                </h1>
                <p className="text-muted-foreground mt-1">
                  {t('overviewDescription')}
                </p>
              </div>

              {/* Stats cards */}
              {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('totalFiles')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.totalFiles}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('totalSize')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatSize(stats.totalSize)}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('longTermSize')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatSize(stats.longTermSize)}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('dailyLogCount')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.dailyLogCount}</div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Long-term memory preview */}
              {longTermMemory && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      {t('longTermMemory')}
                    </CardTitle>
                    <CardDescription>
                      {t('longTermDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/50 p-4 rounded-lg max-h-96 overflow-auto">
                      {longTermMemory}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {/* Info section */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('aboutMemory')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{t('aboutMemoryDesc1')}</p>
                  <p>{t('aboutMemoryDesc2')}</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li><strong>{t('longTermMemory')}</strong>: {t('longTermInfo')}</li>
                    <li><strong>{t('dailyLogs')}</strong>: {t('dailyLogsInfo')}</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}