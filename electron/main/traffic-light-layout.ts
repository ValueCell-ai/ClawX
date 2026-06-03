import { release } from 'node:os';
import type { BrowserWindow } from 'electron';

const MAC_SIDEBAR_CHROME_HEIGHT = 28;
const MAC_TRAFFIC_LIGHT_GAP = 8;
const MAC_TRAFFIC_LIGHT_FRAME_HEIGHT = 16;
const MAC_TRAFFIC_LIGHT_FRAME_HEIGHT_TAHOE = 14;

function getMacTrafficLightFrameHeight(darwinMajor: number): number {
  return darwinMajor >= 25
    ? MAC_TRAFFIC_LIGHT_FRAME_HEIGHT_TAHOE
    : MAC_TRAFFIC_LIGHT_FRAME_HEIGHT;
}

function getMacTrafficLightChromeOffset(buttonFrameHeight: number): number {
  return Math.floor((MAC_SIDEBAR_CHROME_HEIGHT - buttonFrameHeight) / 2);
}

export function getMacTrafficLightPosition(sidebarCollapsed: boolean): { x: number; y: number } {
  const darwinMajor = Number.parseInt(release().split('.')[0] ?? '0', 10);
  const buttonFrameHeight = getMacTrafficLightFrameHeight(darwinMajor);
  const offset = getMacTrafficLightChromeOffset(buttonFrameHeight);

  if (sidebarCollapsed) {
    return { x: MAC_TRAFFIC_LIGHT_GAP, y: Math.max(MAC_TRAFFIC_LIGHT_GAP, offset) };
  }

  return { x: offset + 1, y: offset };
}

export function syncMacTrafficLightPosition(
  win: BrowserWindow,
  sidebarCollapsed: boolean,
): void {
  if (process.platform !== 'darwin' || win.isDestroyed()) {
    return;
  }

  win.setWindowButtonPosition(getMacTrafficLightPosition(sidebarCollapsed));
}
