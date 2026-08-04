import { render } from '@testing-library/react';
import { defaultRehypePlugins, Streamdown } from 'streamdown';
import {
  streamdownAnimation,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from '@/components/markdown/streamdown-config';

describe('shared Streamdown configuration', () => {
  it('enables code, math, and CJK without Mermaid', () => {
    expect(streamdownPlugins).toHaveProperty('code');
    expect(streamdownPlugins).toHaveProperty('math');
    expect(streamdownPlugins).toHaveProperty('cjk');
    expect(streamdownPlugins).not.toHaveProperty('mermaid');
    expect(streamdownPlugins.code?.getThemes()).toEqual(['github-light', 'github-dark']);
  });

  it('retains exactly the safe default rehype plugins', () => {
    expect(streamdownRehypePlugins).toHaveLength(2);
    expect(streamdownRehypePlugins).toEqual(expect.arrayContaining([
      defaultRehypePlugins.sanitize,
      defaultRehypePlugins.harden,
    ]));
    expect(streamdownRehypePlugins).not.toContain(defaultRehypePlugins.raw);
  });

  it('renders single-dollar inline math', () => {
    const { container } = render(
      <Streamdown mode="static" plugins={streamdownPlugins}>
        {'$x$'}
      </Streamdown>,
    );

    expect(container.querySelector('.katex')).toBeInTheDocument();
  });

  it('keeps raw HTML as literal text', () => {
    const source = '<script>alert(1)</script>';
    const { container } = render(
      <Streamdown mode="static" plugins={streamdownPlugins} rehypePlugins={streamdownRehypePlugins}>
        {source}
      </Streamdown>,
    );

    expect(container).toHaveTextContent(source);
    expect(container.querySelector('script')).not.toBeInTheDocument();
  });

  it('enables only code copying and disables link safety', () => {
    expect(streamdownControls).toEqual({
      code: { copy: true, download: false },
      mermaid: false,
      table: false,
    });
    expect(streamdownLinkSafety).toEqual({ enabled: false });
  });

  it('uses the shared word animation settings', () => {
    expect(streamdownAnimation).toEqual({
      animation: 'fadeIn',
      duration: 140,
      stagger: 0,
      sep: 'word',
    });
  });
});
