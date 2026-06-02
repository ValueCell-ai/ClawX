/** macOS sidebar title strip height — matches VS Code compact title bar (px). */
export const MAC_SIDEBAR_CHROME_HEIGHT = 28;

/** Visible traffic-light diameter on macOS (px). */
export const MAC_TRAFFIC_LIGHT_BUTTON_SIZE = 12;

/** Native edge-to-edge gap between traffic light buttons (px). */
export const MAC_TRAFFIC_LIGHT_GAP = 8;

/** Frame height VS Code uses when vertically centering traffic lights (pre-Tahoe). */
export const MAC_TRAFFIC_LIGHT_FRAME_HEIGHT = 16;

/** Frame height on macOS Tahoe and newer. */
export const MAC_TRAFFIC_LIGHT_FRAME_HEIGHT_TAHOE = 14;

/** macOS close + minimize + zoom button group width (px). */
export const MAC_TRAFFIC_LIGHT_GROUP_WIDTH =
  3 * MAC_TRAFFIC_LIGHT_BUTTON_SIZE + 2 * MAC_TRAFFIC_LIGHT_GAP;

/**
 * Collapsed sidebar rail width (px): four spacing units plus three buttons.
 * 4 × 8 + 3 × 12 = 68
 */
export const SIDEBAR_COLLAPSED_WIDTH =
  4 * MAC_TRAFFIC_LIGHT_GAP + 3 * MAC_TRAFFIC_LIGHT_BUTTON_SIZE;

export function getMacTrafficLightFrameHeight(darwinMajor: number): number {
  return darwinMajor >= 25
    ? MAC_TRAFFIC_LIGHT_FRAME_HEIGHT_TAHOE
    : MAC_TRAFFIC_LIGHT_FRAME_HEIGHT;
}

/** VS Code-style inset that vertically centers traffic lights in the chrome strip. */
export function getMacTrafficLightChromeOffset(
  chromeHeight = MAC_SIDEBAR_CHROME_HEIGHT,
  buttonFrameHeight = MAC_TRAFFIC_LIGHT_FRAME_HEIGHT,
): number {
  return Math.floor((chromeHeight - buttonFrameHeight) / 2);
}

export function getMacTrafficLightPosition(options: {
  sidebarCollapsed: boolean;
  chromeHeight?: number;
  buttonFrameHeight?: number;
}): { x: number; y: number } {
  const chromeHeight = options.chromeHeight ?? MAC_SIDEBAR_CHROME_HEIGHT;
  const buttonFrameHeight = options.buttonFrameHeight ?? MAC_TRAFFIC_LIGHT_FRAME_HEIGHT;
  const offset = getMacTrafficLightChromeOffset(chromeHeight, buttonFrameHeight);

  if (options.sidebarCollapsed) {
    // Collapsed rail: keep uniform 8px grid on left / inter-dot / right.
    const spacing = MAC_TRAFFIC_LIGHT_GAP;
    return { x: spacing, y: Math.max(spacing, offset) };
  }

  // Expanded: VS Code aligns left inset with vertical inset (x = offset + 1).
  return { x: offset + 1, y: offset };
}
