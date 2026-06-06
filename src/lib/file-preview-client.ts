import type {
  FilePreviewTreeOptions,
  FileReadBinaryOptions,
} from '@shared/host-api/contract';
import { hostApi } from './host-api';

export type {
  FileListDirEntry as ListDirEntry,
  FileListDirResult as ListDirResult,
  FilePreviewError,
  FilePreviewTreeNode as TreeNode,
  FilePreviewTreeOptions as ListTreeOptions,
  FileReadBinaryOptions as ReadBinaryFileOptions,
  FileListTreeResult as ListTreeResult,
  ReadBinaryFileResult,
  ReadTextFileResult,
  StatFileResult,
  WriteTextFileResult,
} from '@shared/host-api/contract';

export const readTextFile = (path: string) => hostApi.files.readText(path);
export const readBinaryFile = (
  path: string,
  opts?: FileReadBinaryOptions,
) => hostApi.files.readBinary(path, opts);
export const writeTextFile = (path: string, content: string) => hostApi.files.writeText(path, content);
export const statFile = (path: string) => hostApi.files.stat(path);
export const listDir = (path: string) => hostApi.files.listDir(path);
export const listTree = (
  path: string,
  opts?: FilePreviewTreeOptions,
) => hostApi.files.listTree(path, opts);
