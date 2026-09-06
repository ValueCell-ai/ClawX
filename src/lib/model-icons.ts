import claude from '@/assets/model-icons/claude.png';
import deepseek from '@/assets/model-icons/deepseek.png';
import gemini from '@/assets/model-icons/gemini.png';
import kimi from '@/assets/model-icons/kimi.png';
import minimax from '@/assets/model-icons/minimax.png';
import openai from '@/assets/model-icons/openai.png';
import qwen from '@/assets/model-icons/qwen.png';
import zai from '@/assets/model-icons/zai.png';

const modelIconRules = [
  { name: 'claude', prefix: 'claude', asset: claude },
  { name: 'deepseek', prefix: 'deepseek', asset: deepseek },
  { name: 'gemini', prefix: 'gemini', asset: gemini },
  { name: 'kimi', prefix: 'kimi', asset: kimi },
  { name: 'minimax', prefix: 'minimax', asset: minimax },
  { name: 'openai', prefix: 'gpt', asset: openai },
  { name: 'qwen', prefix: 'qwen', asset: qwen },
  { name: 'zai', prefix: 'glm', asset: zai },
] as const;

function findModelIconRule(modelName: string) {
  const normalizedModelName = modelName.trim().toLowerCase();
  return modelIconRules.find(({ prefix }) => normalizedModelName.startsWith(prefix));
}

export function getModelIconName(modelName: string): string | null {
  return findModelIconRule(modelName)?.name ?? null;
}

export function getModelIconAsset(modelName: string): string | null {
  return findModelIconRule(modelName)?.asset ?? null;
}
