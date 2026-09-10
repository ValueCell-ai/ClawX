import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelIcon } from '@/components/common/ModelIcon';
import { getModelIconAsset } from '@/lib/model-icons';

describe('getModelIconAsset', () => {
  it.each([
    ['Claude-3.7-Sonnet', 'claude.png'],
    ['deepseek-v3', 'deepseek.png'],
    ['GEMINI-2.5-PRO', 'gemini.png'],
    ['kimi-k2.7', 'kimi.png'],
    ['MiniMax-M2', 'minimax.png'],
    ['GPT-5.5', 'openai.png'],
    ['qwen3.6-plus', 'qwen.png'],
    ['GLM-5.3-Flash', 'zai.png'],
  ])('maps %s to the matching provider icon', (modelName, iconName) => {
    expect(getModelIconAsset(modelName)).toContain(`/model-icons/${iconName}`);
  });

  it('returns no asset for an unknown model', () => {
    expect(getModelIconAsset('custom-model')).toBeNull();
  });

  it('keeps monochrome logos visible on dark surfaces', () => {
    render(<ModelIcon modelName="gpt-5.5" testId="openai-icon" />);
    render(<ModelIcon modelName="glm-5.3-flash" testId="zai-icon" />);

    expect(screen.getByTestId('openai-icon')).toHaveClass('dark:invert');
    expect(screen.getByTestId('zai-icon')).toHaveClass('dark:invert');
  });

  it('keeps the light Kimi logo visible on light surfaces', () => {
    render(<ModelIcon modelName="kimi-k2.7" testId="kimi-icon" />);

    expect(screen.getByTestId('kimi-icon')).toHaveClass('bg-foreground', 'dark:bg-transparent', 'p-0.5', 'dark:p-0');
  });
});
