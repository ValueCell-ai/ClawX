declare module 'openclaw/plugin-sdk/sqlite-runtime' {
  import type { DatabaseSync } from 'node:sqlite';

  export function ensureOpenClawAgentDatabaseSchema(
    database: DatabaseSync,
    options: {
      agentId: string;
      env?: NodeJS.ProcessEnv;
      path?: string;
      register?: boolean;
    },
  ): void;
}
