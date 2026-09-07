import { app } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type CuaSdkModules = {
  electron: typeof import('@trycua/cua-driver/electron');
  embedded: typeof import('@trycua/cua-driver/embedded');
};

export function getCuaSdkSpecifier(entry: keyof CuaSdkModules): string {
  if (!app.isPackaged) return `@trycua/cua-driver/${entry}`;
  const appPath = app.getAppPath();
  const root = appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath;
  // Pinned CUA 0.21.0 exports. Its UniFFI loader derives native paths from
  // import.meta.url; unpacking files alone leaves virtual ASAR module URLs.
  return pathToFileURL(join(root, 'node_modules/@trycua/cua-driver/dist', `${entry}.js`)).href;
}

export function loadCuaSdk<T extends keyof CuaSdkModules>(entry: T): Promise<CuaSdkModules[T]> {
  return import(/* @vite-ignore */ getCuaSdkSpecifier(entry));
}
