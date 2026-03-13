 import { describe, expect, it } from 'vitest';
 import {
   PROVIDER_TYPES,
   PROVIDER_TYPE_INFO,
   resolveProviderApiKeyForSave,
   resolveProviderModelForSave,
   shouldShowProviderModelId,
 } from '@/lib/providers';
 import {
   BUILTIN_PROVIDER_TYPES,
   getProviderConfig,
   getProviderEnvVar,
   getProviderEnvVars,
 } from '@electron/utils/provider-registry';

 describe('provider metadata', () => {
   it('includes ark in the frontend provider registry', () => {
     expect(PROVIDER_TYPES).toContain('ark');

     expect(PROVIDER_TYPE_INFO).toEqual(
       expect.arrayContaining([
         expect.objectContaining({
           id: 'ark',
           name: 'ByteDance Ark',
           requiresApiKey: true,
           defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
           showBaseUrl: true,
           showModelId: true,
         }),
       ])
     );
   });

   it('includes ark in the backend provider registry', () => {
     expect(BUILTIN_PROVIDER_TYPES).toContain('ark');
     expect(getProviderEnvVar('ark')).toBe('ARK_API_KEY');
     expect(getProviderConfig('ark')).toEqual({
       baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
       api: 'openai-completions',
       apiKeyEnv: 'ARK_API_KEY',
     });
   });

   it('includes novita in the frontend provider registry', () => {
     expect(PROVIDER_TYPES).toContain('novita');

     expect(PROVIDER_TYPE_INFO).toEqual(
       expect.arrayContaining([
         expect.objectContaining({
           id: 'novita',
           name: 'Novita AI',
           requiresApiKey: true,
           defaultBaseUrl: 'https://api.novita.ai/openai',
           showModelId: true,
           defaultModelId: 'deepseek/deepseek-v3.2',
         }),
       ])
     );
   });

   it('includes novita in the backend provider registry', () => {
     expect(BUILTIN_PROVIDER_TYPES).toContain('novita');
     expect(getProviderEnvVar('novita')).toBe('NOVITA_API_KEY');
     expect(getProviderConfig('novita')).toEqual({
       baseUrl: 'https://api.novita.ai/openai',
       api: 'openai-completions',
       apiKeyEnv: 'NOVITA_API_KEY',
     });
   });

   it('uses a single canonical env key for moonshot provider', () => {
     expect(getProviderEnvVar('moonshot')).toBe('MOONSHOT_API_KEY');
     expect(getProviderEnvVars('moonshot')).toEqual(['MOONSHOT_API_KEY']);
     expect(getProviderConfig('moonshot')).toEqual(
       expect.objectContaining({
         baseUrl: 'https://api.moonshot.cn/v1',
         apiKeyEnv: 'MOONSHOT_API_KEY',
       })
     );
   });

   it('keeps builtin provider sources in sync', () => {
     expect(BUILTIN_PROVIDER_TYPES).toEqual(
       expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'ark', 'moonshot', 'siliconflow', 'minimax-portal', 'minimax-portal-cn', 'qwen-portal', 'ollama', 'novita'])
     );
   });

   it('uses OpenAI-compatible Ollama default base URL', () => {
     expect(PROVIDER_TYPE_INFO).toEqual(
       expect.arrayContaining([
         expect.objectContaining({
           id: 'ollama',
           defaultBaseUrl: 'http://localhost:11434/v1',
           requiresApiKey: false,
           showBaseUrl: true,
           showModelId: true,
         }),
       ])
     );
   });

   it('exposes OpenRouter model overrides by default and keeps SiliconFlow developer-only', () => {
     const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
     const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');

     expect(openrouter).toMatchObject({
       showModelId: true,
       defaultModelId: 'anthropic/claude-opus-4.6',
     });
     expect(siliconflow).toMatchObject({
       showModelId: true,
       showModelIdInDevModeOnly: true,
       defaultModelId: 'deepseek-ai/DeepSeek-V3',
     });

     expect(shouldShowProviderModelId(openrouter, false)).toBe(true);
     expect(shouldShowProviderModelId(siliconflow, false)).toBe(false);
     expect(shouldShowProviderModelId(openrouter, true)).toBe(true);
     expect(shouldShowProviderModelId(siliconflow, true)).toBe(true);
   });

   it('exposes Novita model overrides and uses OpenAI-compatible endpoint', () => {
     const novita = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'novita');

     expect(novita).toMatchObject({
       name: 'Novita AI',
       showModelId: true,
       defaultModelId: 'deepseek/deepseek-v3.2',
       defaultBaseUrl: 'https://api.novita.ai/openai',
     });

     expect(shouldShowProviderModelId(novita, false)).toBe(true);
     expect(shouldShowProviderModelId(novita, true)).toBe(true);
   });

   it('saves Novita model overrides by default', () => {
     const novita = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'novita');

     expect(resolveProviderModelForSave(novita, 'deepseek/deepseek-v3.2', false)).toBe('deepseek/deepseek-v3.2');
     expect(resolveProviderModelForSave(novita, 'zai-org/glm-5', false)).toBe('zai-org/glm-5');
     expect(resolveProviderModelForSave(novita, '   ', false)).toBe('deepseek/deepseek-v3.2');
   });

   it('normalizes provider API keys for save flow', () => {
     expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
     expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
     expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
     expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
     expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
   });
});
