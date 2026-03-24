import type { IncomingMessage, ServerResponse } from 'http';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, relative, resolve, normalize } from 'path';
import { homedir } from 'os';
import type { HostApiContext } from '../context';
import { sendJson, setCorsHeaders } from '../route-utils';
import { listAgentsSnapshot } from '../../utils/agent-config';

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.sh', '.bash',
  '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.html', '.htm', '.css',
  '.scss', '.less', '.sql', '.graphql', '.proto', '.lua', '.r',
  '.m', '.mm', '.pl', '.pm', '.php', '.vue', '.svelte', '.astro',
  '.env', '.ini', '.cfg', '.conf', '.log', '.diff', '.patch',
  '.dockerfile', '.gitignore', '.editorconfig', '.prettierrc',
  '.eslintrc', '.babelrc',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit for text previews
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB limit for images

function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return p.replace('~', homedir());
  }
  return p;
}

/**
 * Validate that a requested path is within the allowed workspace root.
 * Prevents path traversal attacks.
 */
function isPathWithinRoot(root: string, requestedPath: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, requestedPath);
  return resolvedPath.startsWith(resolvedRoot);
}

async function buildFileTree(
  dirPath: string,
  rootPath: string,
  depth: number = 0,
  maxDepth: number = 10,
): Promise<FileTreeNode[]> {
  if (depth >= maxDepth) return [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    // Skip hidden files/dirs and common unneeded dirs
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;

    const fullPath = join(dirPath, entry.name);
    const relativePath = relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, rootPath, depth + 1, maxDepth);
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      });
    }
  }

  return nodes;
}

function getFileType(filePath: string): 'text' | 'image' | 'html' | 'binary' {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  // Files with no extension are often text (README, Makefile, etc.)
  if (!ext) return 'text';
  return 'binary';
}

function getLanguageFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.hpp': 'cpp',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.sql': 'sql',
    '.json': 'json',
    '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml',
    '.xml': 'xml',
    '.md': 'markdown',
    '.php': 'php',
    '.lua': 'lua',
    '.r': 'r',
    '.graphql': 'graphql',
    '.proto': 'protobuf',
    '.dockerfile': 'dockerfile',
    '.vue': 'vue',
    '.svelte': 'svelte',
  };
  return map[ext.toLowerCase()] || 'plaintext';
}

export async function handleWorkspaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  // GET /api/workspace/agents — list agents with their workspace paths
  if (url.pathname === '/api/workspace/agents' && req.method === 'GET') {
    try {
      const snapshot = await listAgentsSnapshot();
      const agents = snapshot.agents.map((a) => ({
        id: a.id,
        name: a.name,
        workspace: expandPath(a.workspace),
        isDefault: a.isDefault,
      }));
      sendJson(res, 200, { success: true, agents });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // GET /api/workspace/tree?agent=<agentId> — get file tree for agent's workspace
  if (url.pathname === '/api/workspace/tree' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agent') || 'main';
      const snapshot = await listAgentsSnapshot();
      const agent = snapshot.agents.find((a) => a.id === agentId);
      if (!agent) {
        sendJson(res, 404, { success: false, error: `Agent "${agentId}" not found` });
        return true;
      }

      const workspacePath = expandPath(agent.workspace);
      const tree = await buildFileTree(workspacePath, workspacePath);
      sendJson(res, 200, {
        success: true,
        agentId: agent.id,
        agentName: agent.name,
        workspace: workspacePath,
        tree,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // GET /api/workspace/file?agent=<agentId>&path=<relativePath> — read file content
  if (url.pathname === '/api/workspace/file' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agent') || 'main';
      const filePath = url.searchParams.get('path');

      if (!filePath) {
        sendJson(res, 400, { success: false, error: 'Missing "path" parameter' });
        return true;
      }

      const snapshot = await listAgentsSnapshot();
      const agent = snapshot.agents.find((a) => a.id === agentId);
      if (!agent) {
        sendJson(res, 404, { success: false, error: `Agent "${agentId}" not found` });
        return true;
      }

      const workspacePath = expandPath(agent.workspace);
      const normalizedRelPath = normalize(filePath);

      // Security: prevent path traversal
      if (!isPathWithinRoot(workspacePath, normalizedRelPath)) {
        sendJson(res, 403, { success: false, error: 'Path traversal not allowed' });
        return true;
      }

      const fullPath = join(workspacePath, normalizedRelPath);
      const fileStat = await stat(fullPath);

      if (!fileStat.isFile()) {
        sendJson(res, 400, { success: false, error: 'Not a file' });
        return true;
      }

      const ext = extname(fullPath).toLowerCase();
      const fileType = getFileType(fullPath);

      if (fileType === 'image') {
        if (fileStat.size > MAX_IMAGE_SIZE) {
          sendJson(res, 413, { success: false, error: 'Image too large' });
          return true;
        }
        const buf = await readFile(fullPath);
        const mimeMap: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.bmp': 'image/bmp',
          '.ico': 'image/x-icon',
        };
        const mime = mimeMap[ext] || 'application/octet-stream';
        // Return base64 data URL for images
        setCorsHeaders(res);
        sendJson(res, 200, {
          success: true,
          fileType: 'image',
          mimeType: mime,
          content: `data:${mime};base64,${buf.toString('base64')}`,
          size: fileStat.size,
        });
        return true;
      }

      if (fileType === 'text' || fileType === 'html') {
        if (fileStat.size > MAX_FILE_SIZE) {
          sendJson(res, 413, { success: false, error: 'File too large for preview' });
          return true;
        }
        const content = await readFile(fullPath, 'utf-8');
        sendJson(res, 200, {
          success: true,
          fileType,
          language: getLanguageFromExt(ext),
          content,
          size: fileStat.size,
        });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        fileType: 'binary',
        size: fileStat.size,
        message: 'Binary files cannot be previewed',
      });
    } catch (error) {
      const msg = String(error);
      if (msg.includes('ENOENT')) {
        sendJson(res, 404, { success: false, error: 'File not found' });
      } else {
        sendJson(res, 500, { success: false, error: msg });
      }
    }
    return true;
  }

  return false;
}
