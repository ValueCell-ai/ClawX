/**
 * ClawHub Service
 * Manages interactions with the ClawHub CLI for skills management
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { getOpenClawConfigDir, ensureDir, getClawHubCliBinPath, getClawHubCliEntryPath, quoteForCmd } from '../utils/paths';

export interface ClawHubSearchParams {
    query: string;
    limit?: number;
}

export interface ClawHubInstallParams {
    slug: string;
    version?: string;
    force?: boolean;
}

export interface ClawHubUninstallParams {
    slug: string;
}

export interface ClawHubSkillResult {
    slug: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    downloads?: number;
    stars?: number;
}

export interface ClawHubInstalledSkillResult {
    slug: string;
    version: string;
    source?: string;
    baseDir?: string;
}

export interface MarketplaceProvider {
    getCapability(): Promise<{ mode: string; canSearch: boolean; canInstall: boolean; reason?: string }>;
    search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]>;
    install(params: ClawHubInstallParams): Promise<void>;
}

export class ClawHubService {
    private workDir: string;
    private cliPath: string;
    private cliEntryPath: string;
    private useNodeRunner: boolean;
    private ansiRegex: RegExp;
    private marketplaceProvider: MarketplaceProvider | null = null;

    setMarketplaceProvider(provider: MarketplaceProvider): void {
        this.marketplaceProvider = provider;
    }

    async getMarketplaceCapability(): Promise<{ mode: string; canSearch: boolean; canInstall: boolean; reason?: string }> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.getCapability();
        }
        return { mode: 'clawhub', canSearch: true, canInstall: true };
    }

    constructor() {
        // Use the user's OpenClaw config directory (~/.openclaw) for skill management
        // This avoids installing skills into the project's openclaw submodule
        this.workDir = getOpenClawConfigDir();
        ensureDir(this.workDir);

        const binPath = getClawHubCliBinPath();
        const entryPath = getClawHubCliEntryPath();

        this.cliEntryPath = entryPath;
        if (!app.isPackaged && fs.existsSync(binPath)) {
            this.cliPath = binPath;
            this.useNodeRunner = false;
        } else {
            this.cliPath = process.execPath;
            this.useNodeRunner = true;
        }
        const esc = String.fromCharCode(27);
        const csi = String.fromCharCode(155);
        const pattern = `(?:${esc}|${csi})[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`;
        this.ansiRegex = new RegExp(pattern, 'g');
    }

    private stripAnsi(line: string): string {
        return line.replace(this.ansiRegex, '').trim();
    }

    private extractFrontmatterName(skillManifestPath: string): string | null {
        try {
            const raw = fs.readFileSync(skillManifestPath, 'utf8');
            // Match the first frontmatter block and read `name: ...`
            const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) return null;
            const body = frontmatterMatch[1];
            const nameMatch = body.match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
            if (!nameMatch) return null;
            const name = nameMatch[1].trim();
            return name || null;
        } catch {
            return null;
        }
    }

    private resolveSkillDirByManifestName(candidates: string[]): string | null {
        const skillsRoot = path.join(this.workDir, 'skills');
        if (!fs.existsSync(skillsRoot)) return null;

        const wanted = new Set(
            candidates
                .map((v) => v.trim().toLowerCase())
                .filter((v) => v.length > 0),
        );
        if (wanted.size === 0) return null;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
        } catch {
            return null;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(skillsRoot, entry.name);
            const skillManifestPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillManifestPath)) continue;

            const frontmatterName = this.extractFrontmatterName(skillManifestPath);
            if (!frontmatterName) continue;
            if (wanted.has(frontmatterName.toLowerCase())) {
                return skillDir;
            }
        }
        return null;
    }

    /**
     * Run a ClawHub CLI command
     */
    private async runCommand(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.useNodeRunner && !fs.existsSync(this.cliEntryPath)) {
                reject(new Error(`ClawHub CLI entry not found at: ${this.cliEntryPath}`));
                return;
            }

            if (!this.useNodeRunner && !fs.existsSync(this.cliPath)) {
                reject(new Error(`ClawHub CLI not found at: ${this.cliPath}`));
                return;
            }

            const commandArgs = this.useNodeRunner ? [this.cliEntryPath, ...args] : args;
            const displayCommand = [this.cliPath, ...commandArgs].join(' ');
            console.log(`Running ClawHub command: ${displayCommand}`);

            const isWin = process.platform === 'win32';
            const useShell = isWin && !this.useNodeRunner;
            const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
            const env = {
                ...baseEnv,
                CI: 'true',
                FORCE_COLOR: '0',
            };
            if (this.useNodeRunner) {
                env.ELECTRON_RUN_AS_NODE = '1';
            }
            const spawnCmd = useShell ? quoteForCmd(this.cliPath) : this.cliPath;
            const spawnArgs = useShell ? commandArgs.map(a => quoteForCmd(a)) : commandArgs;
            const child = spawn(spawnCmd, spawnArgs, {
                cwd: this.workDir,
                shell: useShell,
                env: {
                    ...env,
                    CLAWHUB_WORKDIR: this.workDir,
                },
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error) => {
                console.error('ClawHub process error:', error);
                reject(error);
            });

            child.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    console.error(`ClawHub command failed with code ${code}`);
                    console.error('Stderr:', stderr);
                    reject(new Error(`Command failed: ${stderr || stdout}`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    /**
     * Search for skills. Delegates to the marketplace provider if one is set,
     * otherwise falls back to the local ClawHub CLI.
     */
    async search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.search(params);
        }
        try {
            // If query is empty, use 'explore' to show trending skills
            if (!params.query || params.query.trim() === '') {
                return this.explore({ limit: params.limit });
            }

            const args = ['search', params.query];
            if (params.limit) {
                args.push('--limit', String(params.limit));
            }

            const output = await this.runCommand(args);
            if (!output || output.includes('No skills found')) {
                return [];
            }

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const cleanLine = this.stripAnsi(line);

                // Format could be: slug vversion description (score)
                // Or sometimes: slug  vversion  description
                let match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)\s+(.+)$/);
                if (match) {
                    const slug = match[1];
                    const version = match[2];
                    let description = match[3];

                    // Clean up score if present at the end
                    description = description.replace(/\(\d+\.\d+\)$/, '').trim();

                    return {
                        slug,
                        name: slug,
                        version,
                        description,
                    };
                }

                // Fallback for new clawhub search format without version:
                // slug  name/description  (score)
                match = cleanLine.match(/^(\S+)\s+(.+)$/);
                if (match) {
                    const slug = match[1];
                    let description = match[2];

                    // Clean up score if present at the end
                    description = description.replace(/\(\d+\.\d+\)$/, '').trim();

                    return {
                        slug,
                        name: slug,
                        version: 'latest', // Fallback version since it's not provided
                        description,
                    };
                }
                return null;
            }).filter((s): s is ClawHubSkillResult => s !== null);
        } catch (error) {
            console.error('ClawHub search error:', error);
            throw error;
        }
    }

    /**
     * Explore trending skills
     */
    async explore(params: { limit?: number } = {}): Promise<ClawHubSkillResult[]> {
        try {
            const args = ['explore'];
            if (params.limit) {
                args.push('--limit', String(params.limit));
            }

            const output = await this.runCommand(args);
            if (!output) return [];

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const cleanLine = this.stripAnsi(line);

                // Format: slug vversion time description
                // Example: my-skill v1.0.0 2 hours ago A great skill
                const match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)\s+(.+? ago|just now|yesterday)\s+(.+)$/i);
                if (match) {
                    return {
                        slug: match[1],
                        name: match[1],
                        version: match[2],
                        description: match[4],
                    };
                }
                return null;
            }).filter((s): s is ClawHubSkillResult => s !== null);
        } catch (error) {
            console.error('ClawHub explore error:', error);
            throw error;
        }
    }

    /**
     * Install a skill. Delegates to the marketplace provider if one is set,
     * otherwise falls back to the local ClawHub CLI.
     */
    async install(params: ClawHubInstallParams): Promise<void> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.install(params);
        }
        const args = ['install', params.slug];

        if (params.version) {
            args.push('--version', params.version);
        }

        if (params.force) {
            args.push('--force');
        }

        await this.runCommand(args);
    }

    /**
     * Uninstall a skill
     */
    async uninstall(params: ClawHubUninstallParams): Promise<void> {
        const fsPromises = fs.promises;

        // 1. Delete the skill directory
        const skillDir = path.join(this.workDir, 'skills', params.slug);
        if (fs.existsSync(skillDir)) {
            console.log(`Deleting skill directory: ${skillDir}`);
            await fsPromises.rm(skillDir, { recursive: true, force: true });
        }

        // 2. Remove from lock.json
        const lockFile = path.join(this.workDir, '.clawhub', 'lock.json');
        if (fs.existsSync(lockFile)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
                if (lockData.skills && lockData.skills[params.slug]) {
                    console.log(`Removing ${params.slug} from lock.json`);
                    delete lockData.skills[params.slug];
                    await fsPromises.writeFile(lockFile, JSON.stringify(lockData, null, 2));
                }
            } catch (err) {
                console.error('Failed to update ClawHub lock file:', err);
            }
        }
    }

    /**
     * List installed skills
     */
    async listInstalled(): Promise<ClawHubInstalledSkillResult[]> {
        try {
            const output = await this.runCommand(['list']);
            if (!output || output.includes('No installed skills')) {
                return [];
            }

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const cleanLine = this.stripAnsi(line);
                const match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)/);
                if (match) {
                    const slug = match[1];
                    return {
                        slug,
                        version: match[2],
                        source: 'openclaw-managed',
                        baseDir: path.join(this.workDir, 'skills', slug),
                    };
                }
                return null;
            }).filter((s): s is ClawHubInstalledSkillResult => s !== null);
        } catch (error) {
            console.error('ClawHub list error:', error);
            return [];
        }
    }

    private resolveSkillDir(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): string | null {
        const candidates = [skillKeyOrSlug, fallbackSlug]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map(v => v.trim());
        const uniqueCandidates = [...new Set(candidates)];
        if (preferredBaseDir && preferredBaseDir.trim() && fs.existsSync(preferredBaseDir.trim())) {
            return preferredBaseDir.trim();
        }
        const directSkillDir = uniqueCandidates
            .map((id) => path.join(this.workDir, 'skills', id))
            .find((dir) => fs.existsSync(dir));
        return directSkillDir || this.resolveSkillDirByManifestName(uniqueCandidates);
    }

    /**
     * Open skill README/manual in default editor
     */
    async openSkillReadme(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);

        // Try to find documentation file
        const possibleFiles = ['SKILL.md', 'README.md', 'skill.md', 'readme.md'];
        let targetFile = '';

        if (skillDir) {
            for (const file of possibleFiles) {
                const filePath = path.join(skillDir, file);
                if (fs.existsSync(filePath)) {
                    targetFile = filePath;
                    break;
                }
            }
        }

        if (!targetFile) {
            // If no md file, just open the directory
            if (skillDir) {
                targetFile = skillDir;
            } else {
                throw new Error('Skill directory not found');
            }
        }

        try {
            // Open file with default application
            await shell.openPath(targetFile);
            return true;
        } catch (error) {
            console.error('Failed to open skill readme:', error);
            throw error;
        }
    }

    /**
     * Open skill path in file explorer
     */
    async openSkillPath(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);
        if (!skillDir) {
            throw new Error('Skill directory not found');
        }
        const openResult = await shell.openPath(skillDir);
        if (openResult) {
            throw new Error(openResult);
        }
        return true;
    }
}
