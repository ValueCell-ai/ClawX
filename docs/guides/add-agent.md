# Guide: Add / Manage Agent

## Concepts

- **Agent**: An AI bot instance with its own workspace, own model, can be bound to a channel
- **Main Agent**: The default agent (`id: "main"`), always exists
- **Workspace**: The agent's own directory containing sessions, AGENTS.md, SOUL.md...

## Flow for creating a new agent (via UI)

```
User → Agents page → "New Agent" button
→ Enter agent name
→ hostApiFetch('POST /api/agents', { name, options })
→ Main: agent-config.createAgent(name)
  → Create workspace directory
  → Create bootstrap files (AGENTS.md, SOUL.md, TOOLS.md...)
  → Write to ~/.openclaw/openclaw.json (agents.list[])
→ Gateway reload (debouncedReload)
→ UI refresh agent list
```

## Related Files

| File | Role |
|------|------|
| `electron/utils/agent-config.ts` | CRUD agents, workspace management |
| `electron/api/routes/agents.ts` | HTTP routes /api/agents |
| `src/pages/Agents/` | Agents UI page |
| `src/stores/agents.ts` | Zustand store |

## Agent structure in openclaw.json

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "name": "Main Agent",
        "default": true,
        "workspace": "~/.openclaw/workspace",
        "model": "anthropic/claude-sonnet-4-6"
      },
      {
        "id": "my-agent",
        "name": "My Custom Agent",
        "workspace": "~/.openclaw/workspace/agents/my-agent",
        "model": {
          "provider": "openai",
          "model": "gpt-4o"
        }
      }
    ]
  }
}
```

## Bootstrap files created when creating a new agent

| File | Purpose |
|------|---------|
| `AGENTS.md` | List of other agents that can be @ mentioned |
| `SOUL.md` | Agent personality and behavior |
| `TOOLS.md` | List of allowed tools/skills |
| `USER.md` | Information about the user |
| `IDENTITY.md` | Agent identity and role |
| `HEARTBEAT.md` | Cron heartbeat instructions |
| `BOOT.md` | Startup instructions |

## API routes

```
GET    /api/agents                     ← List of agents
POST   /api/agents                     ← Create new { name, inheritWorkspace? }
PUT    /api/agents/:id                 ← Rename
DELETE /api/agents/:id                 ← Delete (and workspace)
GET    /api/agents/:id/workspace       ← Files in workspace
GET    /api/agents/:id/workspace/:file ← Read file
PUT    /api/agents/:id/workspace/:file ← Write file
```

## Bind agent to channel

```
Channels page → Select account → "Bind Agent" dropdown
→ hostApiFetch('PUT /api/channels/binding', { channelType, accountId, agentId })
→ Main: agent-config.assignChannelAccountToAgent()
→ Update openclaw.json (agents[id].channels)
→ Gateway reload
```

```typescript
// In the renderer store
await hostApiFetch('/api/channels/binding', {
  method: 'PUT',
  body: JSON.stringify({ channelType: 'telegram', accountId: 'default', agentId: 'my-agent' }),
});
```

## Call RPC to agent via Gateway

```typescript
// Send message to agent
const store = useGatewayStore();
const response = await store.rpc('send_message', {
  agentId: 'main',
  content: 'Hello!',
  sessionId: 'session-123',
});
```
