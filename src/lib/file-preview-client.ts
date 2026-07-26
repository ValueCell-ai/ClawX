import type {
  FilePreviewTreeOptions,
  FileReadBinaryOptions,
  WorkspaceContextInput,
  WorkspaceFileRef,
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
  WorkspaceContextInput,
  WorkspaceFileRef,
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

export const resolveWorkspaceContext = (input: WorkspaceContextInput) => (
  hostApi.files.resolveWorkspaceContext(input)
);
export const readWorkspaceText = (ref: WorkspaceFileRef) => hostApi.files.readWorkspaceText(ref);
export const readWorkspaceBinary = (input: WorkspaceFileRef & { maxBytes?: number }) => (
  hostApi.files.readWorkspaceBinary(input)
);
export const statWorkspaceFile = (ref: WorkspaceFileRef) => hostApi.files.statWorkspaceFile(ref);
