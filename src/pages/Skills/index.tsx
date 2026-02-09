/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Puzzle,
  RefreshCw,
  Lock,
  Package,
  X,
  Settings,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  Sparkles,
  Download,
  Trash2,
  Globe,
  FileCode,
  Plus,
  Save,
  Key,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Skill, MarketplaceSkill } from '@/types/skill';




// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
}

function SkillDetailDialog({ skill, onClose, onToggle }: SkillDetailDialogProps) {
  const { fetchSkills } = useSkillsStore();
  const [activeTab, setActiveTab] = useState('info');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isEnvExpanded, setIsEnvExpanded] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize config from skill
  useEffect(() => {
    // API Key
    if (skill.config?.apiKey) {
      setApiKey(String(skill.config.apiKey));
    } else {
      setApiKey('');
    }

    // Env Vars
    if (skill.config?.env) {
      const vars = Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(vars);
    } else {
      setEnvVars([]);
    }
  }, [skill.config]);

  const handleOpenClawhub = async () => {
    if (skill.slug) {
      await window.electron.ipcRenderer.invoke('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
    }
  };

  const handleOpenEditor = async () => {
    if (skill.slug) {
      try {
        const result = await window.electron.ipcRenderer.invoke('clawhub:openSkillReadme', skill.slug) as { success: boolean; error?: string };
        if (result.success) {
          toast.success('Opened in editor');
        } else {
          toast.error(result.error || 'Failed to open editor');
        }
      } catch (err) {
        toast.error('Failed to open editor: ' + String(err));
      }
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      // Build env object, filtering out empty keys
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

      // Use direct file access instead of Gateway RPC for reliability
      const result = await window.electron.ipcRenderer.invoke(
        'skill:updateConfig',
        {
          skillKey: skill.id,
          apiKey: apiKey || '', // Empty string will delete the key
          env: envObj // Empty object will clear all env vars
        }
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Refresh skills from gateway to get updated config
      await fetchSkills();

      toast.success('Configuration saved');
    } catch (err) {
      toast.error('Failed to save configuration: ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="flex items-center gap-4">
            <span className="text-4xl">{skill.icon || '🔧'}</span>
            <div>
              <CardTitle className="flex items-center gap-2">
                {skill.name}
                {skill.isCore && <Lock className="h-4 w-4 text-muted-foreground" />}
              </CardTitle>
              <div className="flex gap-2 mt-2">
                {skill.slug && !skill.isBundled && !skill.isCore && (
                  <>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleOpenClawhub}>
                      <Globe className="h-3 w-3" />
                      ClawHub
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleOpenEditor}>
                      <FileCode className="h-3 w-3" />
                      Open Manual
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="info">Information</TabsTrigger>
              <TabsTrigger value="config" disabled={skill.isCore}>Configuration</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              <TabsContent value="info" className="mt-0 space-y-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
                    <p className="text-sm mt-1">{skill.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Version</h3>
                      <p className="font-mono text-sm">{skill.version}</p>
                    </div>
                    {skill.author && (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground">Author</h3>
                        <p className="text-sm">{skill.author}</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">Source</h3>
                    <Badge variant="secondary" className="mt-1 font-normal">
                      {skill.isCore ? 'Core System' : skill.isBundled ? 'Bundled' : 'User Installed'}
                    </Badge>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="config" className="mt-0 space-y-6">
                <div className="space-y-6">
                  {/* API Key Section */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Key className="h-4 w-4 text-primary" />
                      API Key
                    </h3>
                    <Input
                      placeholder="Enter API Key (optional)"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      type="password"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      The primary API key for this skill. Leave blank if not required or configured elsewhere.
                    </p>
                  </div>

                  {/* Environment Variables Section */}
                  <div className="space-y-2 border rounded-md p-3">
                    <div className="flex items-center justify-between w-full">
                      <button
                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                        onClick={() => setIsEnvExpanded(!isEnvExpanded)}
                      >
                        {isEnvExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        Environment Variables
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-5">
                          {envVars.length}
                        </Badge>
                      </button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEnvExpanded(true);
                          handleAddEnv();
                        }}
                      >
                        <Plus className="h-3 w-3" />
                        Add Variable
                      </Button>
                    </div>

                    {isEnvExpanded && (
                      <div className="pt-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        {envVars.length === 0 && (
                          <p className="text-xs text-muted-foreground italic h-8 flex items-center">
                            No environment variables configured.
                          </p>
                        )}

                        {envVars.map((env, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              value={env.key}
                              onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                              className="flex-1 font-mono text-xs bg-muted/20"
                              placeholder="KEY (e.g. BASE_URL)"
                            />
                            <span className="text-muted-foreground ml-1 mr-1">=</span>
                            <Input
                              value={env.value}
                              onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                              className="flex-1 font-mono text-xs bg-muted/20"
                              placeholder="VALUE"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveEnv(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}

                        {envVars.length > 0 && (
                          <p className="text-[10px] text-muted-foreground italic px-1 pt-1">
                            Note: Rows with empty keys will be automatically removed during save.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button onClick={handleSaveConfig} className="gap-2" disabled={isSaving}>
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Saving...' : 'Save Configuration'}
                  </Button>
                </div>
              </TabsContent>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border-t bg-muted/10">
            <div className="flex items-center gap-2">
              {skill.enabled ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">Enabled</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="text-muted-foreground">Disabled</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={skill.enabled}
                onCheckedChange={() => onToggle(!skill.enabled)}
                disabled={skill.isCore}
              />
            </div>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}

// Marketplace skill card component
interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  isInstalling: boolean;
  isInstalled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

function MarketplaceSkillCard({
  skill,
  isInstalling,
  isInstalled,
  onInstall,
  onUninstall
}: MarketplaceSkillCardProps) {
  const handleCardClick = () => {
    window.electron.ipcRenderer.invoke('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
  };

  return (
    <Card
      className="hover:border-primary/50 transition-colors cursor-pointer group"
      onClick={handleCardClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
              📦
            </div>
            <div>
              <CardTitle className="text-base group-hover:text-primary transition-colors">{skill.name}</CardTitle>
              <CardDescription className="text-xs flex items-center gap-2">
                <span>v{skill.version}</span>
                {skill.author && (
                  <>
                    <span>•</span>
                    <span>{skill.author}</span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="wait">
              {isInstalled ? (
                <motion.div
                  key="uninstall"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onUninstall}
                    disabled={isInstalling}
                    asChild
                  >
                    <motion.button whileTap={{ scale: 0.9 }}>
                      {isInstalling ? (
                        <div className="flex items-center justify-center gap-0.5">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="w-1 h-1 bg-current rounded-full"
                              animate={{
                                opacity: [0.3, 1, 0.3],
                                scale: [0.8, 1, 0.8],
                              }}
                              transition={{
                                duration: 0.8,
                                repeat: Infinity,
                                delay: i * 0.15,
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </motion.button>
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="install"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onInstall}
                    disabled={isInstalling}
                    asChild
                  >
                    <motion.button whileTap={{ scale: 0.9 }}>
                      {isInstalling ? (
                        <div className="flex items-center justify-center gap-0.5">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="w-1 h-1 bg-current rounded-full"
                              animate={{
                                opacity: [0.3, 1, 0.3],
                                scale: [0.8, 1, 0.8],
                              }}
                              transition={{
                                duration: 0.8,
                                repeat: Infinity,
                                delay: i * 0.15,
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </motion.button>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {skill.description}
        </p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {skill.downloads !== undefined && (
            <div className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {skill.downloads.toLocaleString()}
            </div>
          )}
          {skill.stars !== undefined && (
            <div className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {skill.stars.toLocaleString()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    installing
  } = useSkillsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedSource, setSelectedSource] = useState<'all' | 'built-in' | 'marketplace'>('all');

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  // Debounce the gateway warning to avoid flickering during brief restarts (like skill toggles)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      // Wait 1.5s before showing the warning
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      // Use setTimeout to avoid synchronous setState in effect
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  // Fetch skills on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesSource = true;
    if (selectedSource === 'built-in') {
      matchesSource = !!skill.isBundled;
    } else if (selectedSource === 'marketplace') {
      matchesSource = !skill.isBundled;
    }

    return matchesSearch && matchesSource;
  }).sort((a, b) => {
    // Enabled skills first
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    // Then core/bundled
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    // Finally alphabetical
    return a.name.localeCompare(b.name);
  });

  const sourceStats = {
    all: skills.length,
    builtIn: skills.filter(s => s.isBundled).length,
    marketplace: skills.filter(s => !s.isBundled).length,
  };

  // Handle toggle
  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success('Skill enabled');
      } else {
        await disableSkill(skillId);
        toast.success('Skill disabled');
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [enableSkill, disableSkill]);

  // Handle marketplace search
  const handleMarketplaceSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (marketplaceQuery.trim()) {
      searchSkills(marketplaceQuery);
    }
  }, [marketplaceQuery, searchSkills]);

  // Handle install
  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug);
      // Automatically enable after install
      // We need to find the skill id which is usually the slug
      await enableSkill(slug);
      toast.success('Skill installed and enabled');
    } catch (err) {
      toast.error(`Failed to install: ${String(err)}`);
    }
  }, [installSkill, enableSkill]);

  // Initial marketplace load (Discovery)
  useEffect(() => {
    if (activeTab === 'marketplace' && searchResults.length === 0 && !searching) {
      searchSkills('');
    }
  }, [activeTab, searchResults.length, searching, searchSkills]);

  // Handle uninstall
  const handleUninstall = useCallback(async (slug: string) => {
    try {
      await uninstallSkill(slug);
      toast.success('Skill uninstalled successfully');
    } catch (err) {
      toast.error(`Failed to uninstall: ${String(err)}`);
    }
  }, [uninstallSkill]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="text-muted-foreground">
            Browse and manage AI capabilities
          </p>
        </div>
        <Button variant="outline" onClick={fetchSkills} disabled={!isGatewayRunning}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Gateway Warning */}
      {showGatewayWarning && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <span className="text-yellow-700 dark:text-yellow-400">
              Gateway is not running. Skills cannot be loaded without an active Gateway.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2">
            <Puzzle className="h-4 w-4" />
            Installed
          </TabsTrigger>
          <TabsTrigger value="marketplace" className="gap-2">
            <Globe className="h-4 w-4" />
            Marketplace
          </TabsTrigger>
          {/* <TabsTrigger value="bundles" className="gap-2">
            <Package className="h-4 w-4" />
            Bundles
          </TabsTrigger> */}
        </TabsList>

        <TabsContent value="all" className="space-y-6 mt-6">
          {/* Search and Filter */}
          <div className="flex gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant={selectedSource === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedSource('all')}
              >
                All ({sourceStats.all})
              </Button>
              <Button
                variant={selectedSource === 'built-in' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedSource('built-in')}
                className="gap-2"
              >
                <Puzzle className="h-3 w-3" />
                Built-in ({sourceStats.builtIn})
              </Button>
              <Button
                variant={selectedSource === 'marketplace' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedSource('marketplace')}
                className="gap-2"
              >
                <Globe className="h-3 w-3" />
                Marketplace ({sourceStats.marketplace})
              </Button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <Card className="border-destructive">
              <CardContent className="py-4 text-destructive flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                {error}
              </CardContent>
            </Card>
          )}

          {/* Skills Grid */}
          {filteredSkills.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Puzzle className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No skills found</h3>
                <p className="text-muted-foreground">
                  {searchQuery ? 'Try a different search term' : 'No skills available'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredSkills.map((skill) => (
                <Card
                  key={skill.id}
                  className={cn(
                    'cursor-pointer hover:border-primary/50 transition-colors',
                    skill.enabled && 'border-primary/50 bg-primary/5'
                  )}
                  onClick={() => setSelectedSkill(skill)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{skill.icon || '🧩'}</span>
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {skill.name}
                            {skill.isCore ? (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            ) : skill.isBundled ? (
                              <Puzzle className="h-3 w-3 text-blue-500/70" />
                            ) : (
                              <Globe className="h-3 w-3 text-purple-500/70" />
                            )}
                          </CardTitle>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!skill.isBundled && !skill.isCore && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUninstall(skill.id);
                            }}
                            asChild
                          >
                            <motion.button whileTap={{ scale: 0.9 }}>
                              <Trash2 className="h-4 w-4" />
                            </motion.button>
                          </Button>
                        )}
                        <Switch
                          checked={skill.enabled}
                          onCheckedChange={(checked) => {
                            handleToggle(skill.id, checked);
                          }}
                          disabled={skill.isCore}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {skill.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      {skill.version && (
                        <Badge variant="outline" className="text-xs">
                          v{skill.version}
                        </Badge>
                      )}
                      {skill.configurable && (
                        <Badge variant="secondary" className="text-xs">
                          <Settings className="h-3 w-3 mr-1" />
                          Configurable
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="space-y-6 mt-6">
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <form onSubmit={handleMarketplaceSearch} className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search marketplace..."
                    value={marketplaceQuery}
                    onChange={(e) => setMarketplaceQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button type="submit" disabled={searching || !marketplaceQuery.trim()} className="min-w-[100px]" asChild>
                  <motion.button whileTap={{ scale: 0.98 }}>
                    <AnimatePresence mode="wait" initial={false}>
                      {searching ? (
                        <motion.div
                          key="searching"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center justify-center gap-1"
                        >
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="w-1.5 h-1.5 bg-current rounded-full"
                              animate={{
                                opacity: [0.3, 1, 0.3],
                                scale: [0.8, 1, 0.8],
                              }}
                              transition={{
                                duration: 0.8,
                                repeat: Infinity,
                                delay: i * 0.15,
                              }}
                            />
                          ))}
                        </motion.div>
                      ) : (
                        <motion.div
                          key="search"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          Search
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </Button>
              </form>
            </div>

            {searchResults.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((skill) => {
                  const isInstalled = skills.some(s => s.id === skill.slug || s.name === skill.name); // Simple check, ideally check by ID/slug
                  return (
                    <MarketplaceSkillCard
                      key={skill.slug}
                      skill={skill}
                      isInstalling={!!installing[skill.slug]}
                      isInstalled={isInstalled}
                      onInstall={() => handleInstall(skill.slug)}
                      onUninstall={() => handleUninstall(skill.slug)}
                    />
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Marketplace</h3>
                  <p className="text-muted-foreground text-center max-w-sm">
                    {searching
                      ? 'Searching ClawHub...'
                      : marketplaceQuery
                        ? 'No skills found matching your search.'
                        : 'Search for new skills to expand your capabilities.'}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* <TabsContent value="bundles" className="space-y-6 mt-6">
          <p className="text-muted-foreground">
            Skill bundles are pre-configured collections of skills for common use cases.
            Enable a bundle to quickly set up multiple related skills at once.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {skillBundles.map((bundle) => (
              <BundleCard
                key={bundle.id}
                bundle={bundle}
                skills={skills}
                onApply={() => handleBundleApply(bundle)}
              />
            ))}
          </div>
        </TabsContent> */}
      </Tabs>



      {/* Skill Detail Dialog */}
      {selectedSkill && (
        <SkillDetailDialog
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onToggle={(enabled) => {
            handleToggle(selectedSkill.id, enabled);
            setSelectedSkill({ ...selectedSkill, enabled });
          }}
        />
      )}
    </div>
  );
}

export default Skills;
