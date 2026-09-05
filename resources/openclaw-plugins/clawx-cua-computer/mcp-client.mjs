import { spawn as nodeSpawn } from 'node:child_process';
import { lstat as nodeLstat, readFile as nodeReadFile } from 'node:fs/promises';

export const MCP_LIMITS = Object.freeze({
  maxDescriptorBytes: 64 * 1024,
  maxLineBytes: 256 * 1024 * 1024,
  maxPending: 64,
  startupTimeoutMs: 10_000,
  requestTimeoutMs: 120_000,
  shutdownTimeoutMs: 2_000,
  maxStderrBytes: 32 * 1024,
});

const SESSION_NAME = 'clawx-primary-desktop';
const MAX_DESCRIPTOR_ITEMS = 256;
const MAX_DESCRIPTOR_STRING_BYTES = 32 * 1024;

export function computerDriverError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function unavailable(message, cause) {
  return computerDriverError('COMPUTER_DRIVER_UNAVAILABLE', message, cause);
}

function driverFailure(message, cause) {
  return computerDriverError('COMPUTER_DRIVER_ERROR', message, cause);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value, { allowEmpty = false } = {}) {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= MAX_DESCRIPTOR_STRING_BYTES;
}

function isAbsoluteCommand(command) {
  return command.startsWith('/')
    || /^[A-Za-z]:[\\/]/u.test(command)
    || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(command);
}

export function validateDescriptor(value) {
  if (!isPlainObject(value)) throw unavailable('descriptor must be an object');
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MCP_LIMITS.maxDescriptorBytes) {
      throw unavailable(`connection descriptor exceeds ${MCP_LIMITS.maxDescriptorBytes} bytes`);
    }
  } catch (error) {
    if (error?.code === 'COMPUTER_DRIVER_UNAVAILABLE') throw error;
    throw unavailable('descriptor must be JSON serializable', error);
  }
  if (value.v !== 1) throw unavailable('descriptor v must be exactly 1');
  if (!isBoundedString(value.generation)) throw unavailable('descriptor generation must be a non-empty bounded string');
  if (!isBoundedString(value.mcpProtocolVersion)) {
    throw unavailable('descriptor mcpProtocolVersion must be a non-empty bounded string');
  }
  if (!isBoundedString(value.command) || !isAbsoluteCommand(value.command)) {
    throw unavailable('descriptor command must be an absolute Unix or Windows path');
  }
  if (!Array.isArray(value.args) || value.args.length > MAX_DESCRIPTOR_ITEMS || !value.args.every((arg) => isBoundedString(arg, { allowEmpty: true }))) {
    throw unavailable('descriptor args must be a bounded string array');
  }
  if (
    !Array.isArray(value.environment)
    || value.environment.length > MAX_DESCRIPTOR_ITEMS
    || !value.environment.every((entry) => (
      isPlainObject(entry)
      && isBoundedString(entry.name)
      && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry.name)
      && isBoundedString(entry.value, { allowEmpty: true })
    ))
  ) {
    throw unavailable('descriptor environment must be a bounded name/value string array');
  }

  return {
    v: 1,
    generation: value.generation,
    mcpProtocolVersion: value.mcpProtocolVersion,
    command: value.command,
    args: [...value.args],
    environment: value.environment.map(({ name, value: environmentValue }) => ({
      name,
      value: environmentValue,
    })),
  };
}

export async function readConnectionDescriptor({
  environment = process.env,
  lstat = nodeLstat,
  readFile = nodeReadFile,
} = {}) {
  const descriptorPath = environment.CLAWX_CUA_CONNECTION_FILE?.trim();
  if (!descriptorPath) throw unavailable('CLAWX_CUA_CONNECTION_FILE is missing');

  try {
    const fileStat = await lstat(descriptorPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw unavailable('connection descriptor must be a regular non-symlink file');
    }
    if (fileStat.size > MCP_LIMITS.maxDescriptorBytes) {
      throw unavailable(`connection descriptor exceeds ${MCP_LIMITS.maxDescriptorBytes} bytes`);
    }
    const raw = await readFile(descriptorPath);
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (Buffer.byteLength(text, 'utf8') > MCP_LIMITS.maxDescriptorBytes) {
      throw unavailable(`connection descriptor exceeds ${MCP_LIMITS.maxDescriptorBytes} bytes`);
    }
    return validateDescriptor(JSON.parse(text));
  } catch (error) {
    if (error?.code === 'COMPUTER_DRIVER_UNAVAILABLE') throw error;
    if (error?.code === 'ENOENT') {
      throw unavailable(
        'ClawX Computer is not ready. On macOS, grant Accessibility and Screen Recording, then restart ClawX. Otherwise reinstall ClawX to restore the bundled driver.',
        error,
      );
    }
    throw unavailable('connection descriptor is unreadable or invalid', error);
  }
}

function textFromMcpFailure(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('; ');
  const structuredCode = typeof result?.structuredContent?.code === 'string'
    ? result.structuredContent.code
    : '';
  const message = [structuredCode, text].filter(Boolean).join(': ') || 'CUA tool call failed';
  return message.slice(0, 4096);
}

export async function createMcpClient(descriptorInput, {
  spawn = nodeSpawn,
  baseEnvironment = process.env,
} = {}) {
  const descriptor = validateDescriptor(descriptorInput);
  const childEnvironment = { ...baseEnvironment };
  for (const entry of descriptor.environment) childEnvironment[entry.name] = entry.value;

  let child;
  try {
    child = spawn(descriptor.command, descriptor.args, {
      env: childEnvironment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    throw unavailable('failed to spawn the local CUA driver', error);
  }
  if (!child?.stdin || !child.stdout || !child.stderr) {
    child?.kill?.();
    throw unavailable('CUA driver did not provide stdio pipes');
  }

  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let stderr = '';
  let closed = false;
  let disposing = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function markClosed(reason) {
    if (closed) return;
    closed = true;
    const detail = stderr.trim() ? `: ${stderr.trim()}` : '';
    rejectPending(unavailable(`${reason}${detail}`));
  }

  function failClosed(error) {
    if (closed) return;
    closed = true;
    rejectPending(error);
    child.kill?.();
  }

  child.stderr.on('data', (chunk) => {
    if (Buffer.byteLength(stderr, 'utf8') >= MCP_LIMITS.maxStderrBytes) return;
    const remaining = MCP_LIMITS.maxStderrBytes - Buffer.byteLength(stderr, 'utf8');
    stderr += Buffer.from(chunk).subarray(0, remaining).toString('utf8');
  });
  child.stdin.on('error', (error) => {
    failClosed(unavailable('failed to write to the CUA driver', error));
  });
  child.on('error', (error) => markClosed(`CUA driver process error: ${error.message || String(error)}`));
  child.on('exit', (code, signal) => markClosed(`CUA driver exited (${code ?? signal ?? 'unknown'})`));

  child.stdout.on('data', (chunk) => {
    if (closed) return;
    stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
    if (stdoutBuffer.length > MCP_LIMITS.maxLineBytes) {
      markClosed(`CUA driver response line exceeds ${MCP_LIMITS.maxLineBytes} bytes`);
      child.kill?.();
      return;
    }

    let newlineIndex = stdoutBuffer.indexOf(0x0a);
    while (newlineIndex !== -1 && !closed) {
      const line = stdoutBuffer.subarray(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.subarray(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const message = JSON.parse(line.toString('utf8'));
          if (!message || message.jsonrpc !== '2.0') {
            throw new Error('invalid JSON-RPC envelope');
          }
          if (message && (typeof message.id === 'number' || typeof message.id === 'string')) {
            const request = pending.get(message.id);
            if (request) {
              pending.delete(message.id);
              clearTimeout(request.timer);
              if (message.error) {
                request.reject(driverFailure(
                  typeof message.error.message === 'string'
                    ? message.error.message.slice(0, 4096)
                    : 'MCP request failed',
                ));
              } else {
                request.resolve(message.result);
              }
            }
          }
        } catch (error) {
          markClosed('CUA driver returned invalid JSON-RPC', error);
          child.kill?.();
        }
      }
      newlineIndex = stdoutBuffer.indexOf(0x0a);
    }
  });

  function writeMessage(message) {
    if (closed) throw unavailable('CUA driver connection is closed');
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) failClosed(unavailable('failed to write to the CUA driver', error));
      });
    } catch (error) {
      const failure = unavailable('failed to write to the CUA driver', error);
      failClosed(failure);
      throw failure;
    }
  }

  function notify(method, params) {
    const message = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    writeMessage(message);
  }

  function request(method, params, timeoutMs = MCP_LIMITS.requestTimeoutMs) {
    if (closed) return Promise.reject(unavailable('CUA driver connection is closed'));
    if (pending.size >= MCP_LIMITS.maxPending) {
      return Promise.reject(unavailable(`CUA driver has ${MCP_LIMITS.maxPending} pending requests`));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        failClosed(unavailable(`CUA driver ${method} request timed out`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        writeMessage({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  try {
    const initialized = await request('initialize', {
      protocolVersion: descriptor.mcpProtocolVersion,
      capabilities: {},
      clientInfo: { name: 'clawx-cua-computer', version: '0.1.0' },
    }, MCP_LIMITS.startupTimeoutMs);
    if (initialized?.protocolVersion !== descriptor.mcpProtocolVersion) {
      throw unavailable('CUA driver returned an incompatible protocol version');
    }
    notify('notifications/initialized');
  } catch (error) {
    child.kill?.();
    if (error?.code === 'COMPUTER_DRIVER_UNAVAILABLE') throw error;
    throw unavailable('failed to initialize the local CUA driver', error);
  }

  return {
    async callTool(name, args, timeoutMs = MCP_LIMITS.requestTimeoutMs) {
      let result;
      try {
        result = await request('tools/call', { name, arguments: args }, timeoutMs);
      } catch (error) {
        if (error?.code === 'COMPUTER_DRIVER_UNAVAILABLE' || error?.code === 'COMPUTER_DRIVER_ERROR') throw error;
        throw driverFailure('CUA tool request failed', error);
      }
      if (result?.isError === true) throw driverFailure(textFromMcpFailure(result));
      return result;
    },
    async dispose() {
      if (disposing) return;
      disposing = true;
      if (!closed) {
        try {
          await request('shutdown', {}, MCP_LIMITS.shutdownTimeoutMs);
          notify('exit');
        } catch {
          // Shutdown is best-effort and bounded.
        }
      }
      closed = true;
      rejectPending(unavailable('CUA driver connection disposed'));
      child.kill?.();
    },
  };
}

export function createProxyManager({
  readDescriptor = readConnectionDescriptor,
  createProxy = createMcpClient,
} = {}) {
  let queue = Promise.resolve();
  let descriptor = null;
  let proxy = null;
  let sessionStarted = false;
  let stopped = false;

  async function disposeCurrent() {
    const current = proxy;
    const shouldEndSession = sessionStarted;
    proxy = null;
    sessionStarted = false;
    if (!current) return;
    if (shouldEndSession) {
      try {
        await current.callTool('end_session', { session: SESSION_NAME }, MCP_LIMITS.shutdownTimeoutMs);
      } catch {
        // The process may already be gone; disposal must still continue.
      }
    }
    await current.dispose();
  }

  function enqueue(operation) {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function ensureProxy() {
    if (!descriptor) throw unavailable('CUA connection descriptor is unavailable');
    if (!proxy) {
      const candidate = await createProxy(descriptor);
      try {
        await candidate.callTool('start_session', { session: SESSION_NAME }, MCP_LIMITS.startupTimeoutMs);
      } catch (error) {
        await candidate.dispose().catch(() => undefined);
        throw error;
      }
      proxy = candidate;
      sessionStarted = true;
    }
    return proxy;
  }

  return {
    execute(operation) {
      return enqueue(async () => {
        if (stopped) throw unavailable('CUA proxy manager is stopped');
        let nextDescriptor;
        try {
          nextDescriptor = await readDescriptor();
        } catch (error) {
          await disposeCurrent().catch(() => undefined);
          descriptor = null;
          throw error;
        }
        if (descriptor?.generation !== nextDescriptor.generation) {
          await disposeCurrent();
        }
        descriptor = nextDescriptor;
        return operation({
          generation: descriptor.generation,
          async callTool(name, args = {}, timeoutMs = MCP_LIMITS.requestTimeoutMs) {
            const current = await ensureProxy();
            try {
              return await current.callTool(name, { ...args, session: SESSION_NAME }, timeoutMs);
            } catch (error) {
              if (proxy === current) await disposeCurrent().catch(() => undefined);
              throw error;
            }
          },
        });
      });
    },
    dispose() {
      return enqueue(async () => {
        stopped = true;
        await disposeCurrent();
        descriptor = null;
      });
    },
  };
}
