import { describe, expect, it } from 'vitest';
import {
  getMacTrafficLightChromeOffset,
  getMacTrafficLightFrameHeight,
  getMacTrafficLightPosition,
  MAC_TRAFFIC_LIGHT_FRAME_HEIGHT,
  MAC_TRAFFIC_LIGHT_GAP,
  MAC_TRAFFIC_LIGHT_GROUP_WIDTH,
  MAC_SIDEBAR_CHROME_HEIGHT,
  SIDEBAR_COLLAPSED_WIDTH,
} from '../../shared/sidebar-layout';

describe('macOS traffic light layout', () => {
  it('matches VS Code vertical centering in the chrome strip', () => {
    const offset = getMacTrafficLightChromeOffset(
      MAC_SIDEBAR_CHROME_HEIGHT,
      MAC_TRAFFIC_LIGHT_FRAME_HEIGHT,
    );
    expect(offset).toBe(6);

    const expanded = getMacTrafficLightPosition({
      sidebarCollapsed: false,
      buttonFrameHeight: MAC_TRAFFIC_LIGHT_FRAME_HEIGHT,
    });
    expect(expanded).toEqual({ x: 7, y: 6 });
  });

  it('uses a uniform spacing grid when the sidebar is collapsed', () => {
    const collapsed = getMacTrafficLightPosition({
      sidebarCollapsed: true,
      buttonFrameHeight: MAC_TRAFFIC_LIGHT_FRAME_HEIGHT,
    });
    const spacing = MAC_TRAFFIC_LIGHT_GAP;

    expect(collapsed.x).toBe(spacing);
    expect(collapsed.y).toBeGreaterThanOrEqual(spacing);

    const leftInset = collapsed.x;
    const rightInset = SIDEBAR_COLLAPSED_WIDTH - (collapsed.x + MAC_TRAFFIC_LIGHT_GROUP_WIDTH);
    expect(leftInset).toBe(spacing);
    expect(rightInset).toBe(spacing);
  });

  it('uses a smaller frame height on Tahoe and newer', () => {
    expect(getMacTrafficLightFrameHeight(24)).toBe(MAC_TRAFFIC_LIGHT_FRAME_HEIGHT);
    expect(getMacTrafficLightFrameHeight(25)).toBe(14);
  });
});
