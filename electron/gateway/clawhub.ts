/**
 * ClawHub Service
 * Maintains marketplace-provider compatibility and managed skill uninstall/open helpers.
 */
import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import { getOpenClawConfigDir, ensureDir } from '../utils/paths';
import { removeSkillConfig } from '../utils/skill-config';

export interface MarketplaceSearchParams {
    query: string;
    limit?: number;
}

export interface MarketplaceInstallParams {
    slug: string;
    version?: string;
    force?: boolean;
}

export interface MarketplaceUninstallParams {
    slug: string;
}

export interface MarketplaceSkillResult {
    slug: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    downloads?: number;
    stars?: number;
}

export type ClawHubSearchParams = MarketplaceSearchParams;
export type ClawHubInstallParams = MarketplaceInstallParams;
export type ClawHubUninstallParams = MarketplaceUninstallParams;
export type ClawHubSkillResult = MarketplaceSkillResult;

export interface ClawHubInstalledSkillResult {
    slug: string;
    version: string;
    source?: string;
    baseDir?: string;
}

export interface MarketplaceProvider {
    getCapability(): Promise<{ mode: string; canSearch: boolean; canInstall: boolean; reason?: string }>;
    search(params: MarketplaceSearchParams): Promise<MarketplaceSkillResult[]>;
    install(params: MarketplaceInstallParams): Promise<void>;
}

export class ClawHubService {
    private workDir: string;
    private marketplaceProvider: MarketplaceProvider | null = null;

    constructor() {
        this.workDir = getOpenClawConfigDir();
        ensureDir(this.workDir);
    }

    setMarketplaceProvider(provider: MarketplaceProvider): void {
        this.marketplaceProvider = provider;
    }

    async getMarketplaceCapability(): Promise<{ mode: string; canSearch: boolean; canInstall: boolean; reason?: string }> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.getCapability();
        }
        return {
            mode: 'local-only',
            canSearch: false,
            canInstall: false,
            reason: 'marketplace-disabled',
        };
    }

    /**
     * Search for skills via an extension-provided marketplace.
     */
    async search(params: MarketplaceSearchParams): Promise<MarketplaceSkillResult[]> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.search(params);
        }
        throw new Error('Marketplace search is disabled');
    }

    /**
     * Explore marketplace skills via the registered marketplace provider.
     */
    async explore(params: { limit?: number } = {}): Promise<MarketplaceSkillResult[]> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.search({ query: '', limit: params.limit });
        }
        throw new Error('Marketplace search is disabled');
    }

    /**
     * Install a skill through an extension-provided marketplace.
     */
    async install(params: MarketplaceInstallParams): Promise<void> {
        if (this.marketplaceProvider) {
            return this.marketplaceProvider.install(params);
        }
        throw new Error('Marketplace install is disabled');
    }

    /**
     * Uninstall a managed skill and remove its stored config.
     */
    async uninstall(params: ClawHubUninstallParams): Promise<void> {
        const fsPromises = fs.promises;

        const skillDir = path.join(this.workDir, 'skills', params.slug);
        if (fs.existsSync(skillDir)) {
            console.log(`Deleting skill directory: ${skillDir}`);
            await fsPromises.rm(skillDir, { recursive: true, force: true });
        }

        const lockFile = path.join(this.workDir, '.clawhub', 'lock.json');
        if (fs.existsSync(lockFile)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as {
                    skills?: Record<string, unknown>;
                };
                if (lockData.skills && lockData.skills[params.slug]) {
                    console.log(`Removing ${params.slug} from lock.json`);
                    delete lockData.skills[params.slug];
                    await fsPromises.writeFile(lockFile, JSON.stringify(lockData, null, 2));
                }
            } catch (err) {
                console.error('Failed to update ClawHub lock file:', err);
            }
        }

        await removeSkillConfig(params.slug);
    }

    /**
     * List installed managed skills from the filesystem.
     */
    async listInstalled(): Promise<ClawHubInstalledSkillResult[]> {
        const skillsRoot = path.join(this.workDir, 'skills');
        if (!fs.existsSync(skillsRoot)) {
            return [];
        }

        try {
            const entries = await fs.promises.readdir(skillsRoot, { withFileTypes: true });
            const items = await Promise.all(entries
                .filter((entry) => entry.isDirectory())
                .map(async (entry) => {
                    const skillDir = path.join(skillsRoot, entry.name);
                    const manifestPath = path.join(skillDir, 'SKILL.md');
                    if (!fs.existsSync(manifestPath)) return null;

                    let version = 'unknown';
                    const manifestJsonPath = path.join(skillDir, 'manifest.json');
                    if (fs.existsSync(manifestJsonPath)) {
                        try {
                            const manifestJson = JSON.parse(await fs.promises.readFile(manifestJsonPath, 'utf8')) as { version?: string };
                            version = manifestJson.version?.trim() || version;
                        } catch {
                            // Ignore malformed manifest.json
                        }
                    }

                    const originJsonPath = path.join(skillDir, '.clawhub', 'origin.json');
                    if (fs.existsSync(originJsonPath)) {
                        try {
                            const originJson = JSON.parse(await fs.promises.readFile(originJsonPath, 'utf8')) as { installedVersion?: string };
                            version = originJson.installedVersion?.trim() || version;
                        } catch {
                            // Ignore malformed origin.json
                        }
                    }

                    return {
                        slug: entry.name,
                        version,
                        source: 'openclaw-managed',
                        baseDir: skillDir,
                    };
                }));
            return items.filter((item): item is NonNullable<typeof item> => item !== null);
        } catch (error) {
            console.error('ClawHub list error:', error);
            return [];
        }
    }

    private extractFrontmatterName(skillManifestPath: string): string | null {
        try {
            const raw = fs.readFileSync(skillManifestPath, 'utf8');
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

    async openSkillReadme(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);

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
            if (skillDir) {
                targetFile = skillDir;
            } else {
                throw new Error('Skill directory not found');
            }
        }

        try {
            await shell.openPath(targetFile);
            return true;
        } catch (error) {
            console.error('Failed to open skill readme:', error);
            throw error;
        }
    }

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
