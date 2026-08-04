import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import {
  defaultRehypePlugins,
  type AnimateOptions,
  type ControlsConfig,
  type LinkSafetyConfig,
  type PluginConfig,
} from 'streamdown';

export const streamdownPlugins: PluginConfig = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
  math: createMathPlugin({ singleDollarTextMath: true }),
  cjk,
};

const { raw: omittedRawPlugin, ...safeDefaultRehypePlugins } = defaultRehypePlugins;
void omittedRawPlugin;

export const streamdownRehypePlugins = Object.values(safeDefaultRehypePlugins);

export const streamdownLinkSafety = {
  enabled: false,
} as const satisfies LinkSafetyConfig;

export const streamdownControls = {
  code: { copy: true, download: false },
  mermaid: false,
  table: false,
} as const satisfies ControlsConfig;

export const streamdownAnimation = {
  animation: 'fadeIn',
  duration: 140,
  stagger: 0,
  sep: 'word',
} as const satisfies AnimateOptions;
