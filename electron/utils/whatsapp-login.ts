import { dirname, join } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { deflateSync } from 'zlib';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

const require = createRequire(import.meta.url);

// Resolve dependencies from OpenClaw package context (pnpm-safe)
const openclawPath = getOpenClawDir();
const openclawResolvedPath = getOpenClawResolvedDir();
const openclawRequire = createRequire(join(openclawResolvedPath, 'package.json'));

function resolveOpenClawPackageJson(packageName: string): string {
    const specifier = `${packageName}/package.json`;
    try {
        return openclawRequire.resolve(specifier);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Failed to resolve "${packageName}" from OpenClaw context. ` +
            `openclawPath=${openclawPath}, resolvedPath=${openclawResolvedPath}. ${reason}`,
            { cause: err }
        );
    }
}

const baileysPath = dirname(resolveOpenClawPackageJson('@whiskeysockets/baileys'));
const qrcodeTerminalPath = dirname(resolveOpenClawPackageJson('qrcode-terminal'));

// Load Baileys dependencies dynamically
const {
    default: makeWASocket,
    useMultiFileAuthState: initAuth, // Rename to avoid React hook linter error
    DisconnectReason,
    fetchLatestBaileysVersion
} = require(baileysPath);

// Load QRCode dependencies dynamically
const QRCodeModule = require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'index.js'));
const QRErrorCorrectLevelModule = require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'QRErrorCorrectLevel.js'));

// Types from Baileys (approximate since we don't have types for dynamic require)
interface BaileysError extends Error {
    output?: { statusCode?: number };
}
type BaileysSocket = ReturnType<typeof makeWASocket>;
type ConnectionState = {
    connection: 'close' | 'open' | 'connecting';
    lastDisconnect?: {
        error?: Error & { output?: { statusCode?: number } };
    };
    qr?: string;
};

// --- QR Generation Logic (Adapted from OpenClaw) ---

const QRCode = QRCodeModule;
const QRErrorCorrectLevel = QRErrorCorrectLevelModule;

function createQrMatrix(input: string) {
    const qr = new QRCode(-1, QRErrorCorrectLevel.L);
    qr.addData(input);
    qr.make();
    return qr;
}

function fillPixel(
    buf: Buffer,
    x: number,
    y: number,
    width: number,
    r: number,
    g: number,
    b: number,
    a = 255,
) {
    const idx = (y * width + x) * 4;
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = a;
}

function crcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
}

const CRC_TABLE = crcTable();

function crc32(buf: Buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(buffer: Buffer, width: number, height: number) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let row = 0; row < height; row += 1) {
        const rawOffset = row * (stride + 1);
        raw[rawOffset] = 0; // filter: none
        buffer.copy(raw, rawOffset + 1, row * stride, row * stride + stride);
    }
    const compressed = deflateSync(raw);

    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', compressed),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

async function renderQrPngBase64(
    input: string,
    opts: { scale?: number; marginModules?: number } = {},
): Promise<string> {
    const { scale = 6, marginModules = 4 } = opts;
    const qr = createQrMatrix(input);
    const modules = qr.getModuleCount();
    const size = (modules + marginModules * 2) * scale;

    const buf = Buffer.alloc(size * size * 4, 255);
    for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
            if (!qr.isDark(row, col)) {
                continue;
            }
            const startX = (col + marginModules) * scale;
            const startY = (row + marginModules) * scale;
            for (let y = 0; y < scale; y += 1) {
                const pixelY = startY + y;
                for (let x = 0; x < scale; x += 1) {
                    const pixelX = startX + x;
                    fillPixel(buf, pixelX, pixelY, size, 0, 0, 0, 255);
                }
            }
        }
    }

    const png = encodePngRgba(buf, size, size);
    return png.toString('base64');
}

// --- WhatsApp Login Manager ---

export class WhatsAppLoginManager extends EventEmitter {
    private socket: BaileysSocket | null = null;
    private qr: string | null = null;
    private accountId: string | null = null;
    private active: boolean = false;
    private retryCount: number = 0;
    private maxRetries: number = 5;

    constructor() {
        super();
    }

    /**
     * Finish login: close socket and emit success after credentials are saved
     */
    private async finishLogin(accountId: string): Promise<void> {
        if (!this.active) return;
        console.log('[WhatsAppLogin] Finishing login, closing socket to hand over to Gateway...');
        await this.stop();
        // Allow enough time for WhatsApp server to fully release the session
        await new Promise(resolve => setTimeout(resolve, 5000));
        this.emit('success', { accountId });
    }

    /**
     * Start WhatsApp pairing process
     */
    async start(accountId: string = 'default'): Promise<void> {
        if (this.active && this.accountId === accountId) {
            // Already running for this account, emit current QR if available
            if (this.qr) {
                const base64 = await renderQrPngBase64(this.qr);
                this.emit('qr', { qr: base64, raw: this.qr });
            }
            return;
        }

        // Stop existing if different account or restart requested
        if (this.active) {
            await this.stop();
        }

        this.accountId = accountId;
        this.active = true;
        this.qr = null;
        this.retryCount = 0;

        await this.connectToWhatsApp(accountId);
    }

    private async connectToWhatsApp(accountId: string): Promise<void> {
        if (!this.active) return;

        try {
            // Path where OpenClaw expects WhatsApp credentials
            const authDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp', accountId);

            // Ensure directory exists
            if (!existsSync(authDir)) {
                mkdirSync(authDir, { recursive: true });
            }

            console.log(`[WhatsAppLogin] Connecting for ${accountId} at ${authDir} (Attempt ${this.retryCount + 1})`);


            let pino: (...args: unknown[]) => Record<string, unknown>;
            try {
                // Try to resolve pino from baileys context since it's a dependency of baileys
                const baileysRequire = createRequire(join(baileysPath, 'package.json'));
                pino = baileysRequire('pino');
            } catch (e) {
                console.warn('[WhatsAppLogin] Could not load pino from baileys, trying root', e);
                try {
                    pino = require('pino');
                } catch {
                    console.warn('[WhatsAppLogin] Pino not found, using console fallback');
                    // Mock pino logger if missing
                    pino = () => ({
                        trace: () => { },
                        debug: () => { },
                        info: () => { },
                        warn: () => { },
                        error: () => { },
                        fatal: () => { },
                        child: () => pino(),
                    });
                }
            }

            console.log('[WhatsAppLogin] Loading auth state...');
            const { state, saveCreds } = await initAuth(authDir);

            console.log('[WhatsAppLogin] Fetching latest version...');
            const { version } = await fetchLatestBaileysVersion();

            console.log(`[WhatsAppLogin] Starting login for ${accountId}, version: ${version}`);

            this.socket = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }), // Silent logger
                connectTimeoutMs: 60000,
                // mobile: false,
                // browser: ['ClawX', 'Chrome', '1.0.0'],
            });

            let connectionOpened = false;
            let credsReceived = false;
            let credsTimeout: ReturnType<typeof setTimeout> | null = null;

            this.socket.ev.on('creds.update', async () => {
                await saveCreds();
                if (connectionOpened && !credsReceived) {
                    credsReceived = true;
                    if (credsTimeout) clearTimeout(credsTimeout);
                    console.log('[WhatsAppLogin] Credentials saved after connection open, finishing login...');
                    // Small delay to ensure file writes are fully flushed
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await this.finishLogin(accountId);
                }
            });

            this.socket.ev.on('connection.update', async (update: ConnectionState) => {
                try {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr) {
                        this.qr = qr;
                        console.log('[WhatsAppLogin] QR received');
                        const base64 = await renderQrPngBase64(qr);
                        if (this.active) this.emit('qr', { qr: base64, raw: qr });
                    }

                    if (connection === 'close') {
                        const error = lastDisconnect?.error as BaileysError | undefined;
                        const statusCode = error?.output?.statusCode;
                        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                        // Treat 401 as transient if we haven't exhausted retries (max 2 attempts)
                        // This handles the case where WhatsApp's session hasn't fully released
                        const shouldReconnect = !isLoggedOut || this.retryCount < 2;
                        console.log('[WhatsAppLogin] Connection closed.',
                            'Reconnect:', shouldReconnect,
                            'Active:', this.active,
                            'Error:', error?.message
                        );

                        if (shouldReconnect && this.active) {
                            if (this.retryCount < this.maxRetries) {
                                this.retryCount++;
                                console.log(`[WhatsAppLogin] Reconnecting in 1s... (Attempt ${this.retryCount}/${this.maxRetries})`);
                                setTimeout(() => this.connectToWhatsApp(accountId), 1000);
                            } else {
                                console.log('[WhatsAppLogin] Max retries reached, stopping.');
                                this.active = false;
                                this.emit('error', 'Connection failed after multiple retries');
                            }
                        } else {
                            // Logged out or explicitly stopped
                            this.active = false;
                            if (error?.output?.statusCode === DisconnectReason.loggedOut) {
                                try {
                                    rmSync(authDir, { recursive: true, force: true });
                                } catch (err) {
                                    console.error('[WhatsAppLogin] Failed to clear auth dir:', err);
                                }
                            }
                            if (this.socket) {
                                this.socket.end(undefined);
                                this.socket = null;
                            }
                            this.emit('error', 'Logged out');
                        }
                    } else if (connection === 'open') {
                        console.log('[WhatsAppLogin] Connection opened! Waiting for credentials to be saved...');
                        this.retryCount = 0;
                        connectionOpened = true;

                        // Safety timeout: if creds don't update within 15s, proceed anyway
                        credsTimeout = setTimeout(async () => {
                            if (!credsReceived && this.active) {
                                console.warn('[WhatsAppLogin] Timed out waiting for creds.update after connection open, proceeding...');
                                await this.finishLogin(accountId);
                            }
                        }, 15000);
                    }
                } catch (innerErr) {
                    console.error('[WhatsAppLogin] Error in connection update:', innerErr);
                }
            });

        } catch (error) {
            console.error('[WhatsAppLogin] Fatal Connect Error:', error);
            if (this.active && this.retryCount < this.maxRetries) {
                this.retryCount++;
                setTimeout(() => this.connectToWhatsApp(accountId), 2000);
            } else {
                this.active = false;
                const msg = error instanceof Error ? error.message : String(error);
                this.emit('error', msg);
            }
        }
    }

    /**
     * Stop current login process
     */
    async stop(): Promise<void> {
        this.active = false;
        this.qr = null;
        if (this.socket) {
            try {
                // Remove listeners to prevent handling closure as error
                this.socket.ev.removeAllListeners('connection.update');
                // Use ws.close() for proper WebSocket teardown
                // This ensures WhatsApp server receives a clean close frame
                // and releases the session, preventing 401 on next connect
                try {
                    this.socket.ws?.close();
                } catch {
                    // ws may already be closed
                }
                this.socket.end(undefined);
            } catch {
                // Ignore error if socket already closed
            }
            this.socket = null;
        }
    }
}

export const whatsAppLoginManager = new WhatsAppLoginManager();
