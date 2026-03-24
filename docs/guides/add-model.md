# Guide: Add Model / Provider

## Concepts

- **Provider**: An AI service (Anthropic, OpenAI, Gemini, custom...)
- **Provider Account**: A specific configuration for a provider (includes API key, base URL...)
- **Model**: Belongs to a provider, selected when configuring an agent

## Flow for adding a new provider (via UI)

```
User → Models page → "Add Provider" button
→ Select vendor type (Anthropic, OpenAI, Custom...)
→ Enter API key
→ hostApiFetch('POST /api/providers/accounts')
→ Main: provider-service.createAccount()
→ Save account → ~/.openclaw/providers-accounts.json
→ Save API key → OS keychain
→ provider-runtime-sync.syncSavedProviderToRuntime()
→ Update ~/.openclaw/openclaw.json
→ Gateway reload (debouncedReload)
```

## Related Files

| File | Role |
|------|------|
| `shared/providers/registry.ts` | Define the list of supported providers |
| `shared/providers/types.ts` | Types: ProviderDefinition, ProviderAccount |
| `electron/services/providers/provider-service.ts` | CRUD provider accounts |
| `electron/services/providers/provider-store.ts` | Persist accounts to file |
| `electron/services/providers/provider-runtime-sync.ts` | Sync → openclaw.json |
| `electron/services/providers/provider-validation.ts` | Test API key |
| `electron/services/secrets/secret-store.ts` | Save API key to OS keychain |
| `src/pages/Models/` | Models UI page |
| `src/stores/providers.ts` | Zustand store |

## Adding a new Provider type

### 1. Register in registry

```typescript
// shared/providers/registry.ts
export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  // ... existing providers ...
  {
    id: 'my-provider',
    name: 'My Provider',
    apiProtocol: 'openai-compatible',   // or 'anthropic', 'gemini', 'custom'
    baseUrl: 'https://api.myprovider.com/v1',
    authType: 'bearer',                  // 'bearer' | 'custom-header' | 'none'
    supportsCustomBaseUrl: false,
    models: [
      { id: 'my-model-v1', name: 'My Model V1' },
      { id: 'my-model-v2', name: 'My Model V2' },
    ],
  },
];
```

### 2. Add i18n (if needed)

```json
// src/i18n/locales/en/settings.json (or appropriate file)
{
  "providers": {
    "my-provider": {
      "name": "My Provider",
      "description": "..."
    }
  }
}
```

### 3. No additional changes needed

- `provider-service.ts` automatically handles based on registry
- The Models UI page automatically displays the new provider
- Runtime sync automatically updates openclaw.json

## openclaw.json structure (models section)

```json
{
  "models": {
    "providers": [
      {
        "id": "anthropic",
        "type": "anthropic",
        "apiKey": "sk-ant-...",
        "models": ["claude-opus-4-6", "claude-sonnet-4-6"]
      },
      {
        "id": "openai",
        "type": "openai",
        "apiKey": "sk-...",
        "models": ["gpt-4o", "gpt-4-turbo"]
      }
    ],
    "default": "anthropic/claude-sonnet-4-6"
  }
}
```
