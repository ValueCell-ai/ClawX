/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { toast } from 'sonner';
import {
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
  type ChannelMeta,
  type ChannelConfigField,
} from '@/types/channel';

interface SetupStep {
  id: string;
  title: string;
  description: string;
}

const STEP = {
  WELCOME: 0,
  RUNTIME: 1,
  PROVIDER: 2,
  CHANNEL: 3,
  INSTALLING: 4,
  COMPLETE: 5,
} as const;

const steps: SetupStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ClawX',
    description: 'Your AI assistant is ready to be configured',
  },
  {
    id: 'runtime',
    title: 'Environment Check',
    description: 'Verifying system requirements',
  },
  {
    id: 'provider',
    title: 'AI Provider',
    description: 'Configure your AI service',
  },
  {
    id: 'channel',
    title: 'Connect a Channel',
    description: 'Connect a messaging platform (optional)',
  },
  {
    id: 'installing',
    title: 'Setting Up',
    description: 'Installing essential components',
  },
  {
    id: 'complete',
    title: 'All Set!',
    description: 'ClawX is ready to use',
  },
];

// Default skills to auto-install (no additional API keys required)
interface DefaultSkill {
  id: string;
  name: string;
  description: string;
}

const defaultSkills: DefaultSkill[] = [
  { id: 'opencode', name: 'OpenCode', description: 'AI coding assistant backend' },
  { id: 'python-env', name: 'Python Environment', description: 'Python runtime for skills' },
  { id: 'code-assist', name: 'Code Assist', description: 'Code analysis and suggestions' },
  { id: 'file-tools', name: 'File Tools', description: 'File operations and management' },
  { id: 'terminal', name: 'Terminal', description: 'Shell command execution' },
];

// Provider types
interface Provider {
  id: string;
  name: string;
  model: string;
  icon: string;
  placeholder: string;
}

const providers: Provider[] = [
  { id: 'anthropic', name: 'Anthropic', model: 'Claude', icon: '🤖', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', model: 'GPT-4', icon: '💚', placeholder: 'sk-...' },
  { id: 'google', name: 'Google', model: 'Gemini', icon: '🔷', placeholder: 'AI...' },
  { id: 'openrouter', name: 'OpenRouter', model: 'Multi-Model', icon: '🌐', placeholder: 'sk-or-...' },
];

// NOTE: Channel types moved to Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  
  // Setup state
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  // Installation state for the Installing step
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  // Runtime check status
  const [runtimeChecksPassed, setRuntimeChecksPassed] = useState(false);
  
  const step = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  
  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);
  
  // Derive canProceed based on current step - computed directly to avoid useEffect
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case STEP.WELCOME:
        return true;
      case STEP.RUNTIME:
        return runtimeChecksPassed;
      case STEP.PROVIDER:
        return selectedProvider !== null && apiKey.length > 0;
      case STEP.CHANNEL:
        return true; // Always allow proceeding — channel step is optional
      case STEP.INSTALLING:
        return false; // Cannot manually proceed, auto-proceeds when done
      case STEP.COMPLETE:
        return true;
      default:
        return true;
    }
  }, [currentStep, selectedProvider, apiKey, runtimeChecksPassed]);
  
  const handleNext = async () => {
    if (isLastStep) {
      // Complete setup
      markSetupComplete();
      toast.success('Setup complete! Welcome to ClawX');
      navigate('/');
    } else {
      setCurrentStep((i) => i + 1);
    }
  };
  
  const handleBack = () => {
    setCurrentStep((i) => Math.max(i - 1, 0));
  };
  
  const handleSkip = () => {
    markSetupComplete();
    navigate('/');
  };
  
  // Auto-proceed when installation is complete
  const handleInstallationComplete = useCallback((skills: string[]) => {
    setInstalledSkills(skills);
    // Auto-proceed to next step after a short delay
    setTimeout(() => {
      setCurrentStep((i) => i + 1);
    }, 1000);
  }, []);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Progress Indicator */}
      <div className="flex justify-center pt-8">
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                  i < currentStep
                    ? 'border-primary bg-primary text-primary-foreground'
                    : i === currentStep
                    ? 'border-primary text-primary'
                    : 'border-slate-600 text-slate-600'
                )}
              >
                {i < currentStep ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="text-sm">{i + 1}</span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 w-8 transition-colors',
                    i < currentStep ? 'bg-primary' : 'bg-slate-600'
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      
      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="mx-auto max-w-2xl p-8"
        >
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">{step.title}</h1>
            <p className="text-slate-400">{step.description}</p>
          </div>
          
          {/* Step-specific content */}
          <div className="rounded-xl bg-white/10 backdrop-blur p-8 mb-8">
            {currentStep === STEP.WELCOME && <WelcomeContent />}
            {currentStep === STEP.RUNTIME && <RuntimeContent onStatusChange={setRuntimeChecksPassed} />}
            {currentStep === STEP.PROVIDER && (
              <ProviderContent
                providers={providers}
                selectedProvider={selectedProvider}
                onSelectProvider={setSelectedProvider}
                apiKey={apiKey}
                onApiKeyChange={setApiKey}
              />
            )}
            {currentStep === STEP.CHANNEL && <SetupChannelContent />}
            {currentStep === STEP.INSTALLING && (
              <InstallingContent
                skills={defaultSkills}
                onComplete={handleInstallationComplete}
                onSkip={() => setCurrentStep((i) => i + 1)}
              />
            )}
            {currentStep === STEP.COMPLETE && (
              <CompleteContent
                selectedProvider={selectedProvider}
                installedSkills={installedSkills}
              />
            )}
          </div>
          
          {/* Navigation - hidden during installation step */}
          {currentStep !== STEP.INSTALLING && (
            <div className="flex justify-between">
              <div>
                {!isFirstStep && (
                  <Button variant="ghost" onClick={handleBack}>
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {currentStep === STEP.CHANNEL && (
                  <Button variant="ghost" onClick={handleNext}>
                    Skip this step
                  </Button>
                )}
                {!isLastStep && currentStep !== STEP.RUNTIME && currentStep !== STEP.CHANNEL && (
                  <Button variant="ghost" onClick={handleSkip}>
                    Skip Setup
                  </Button>
                )}
                <Button onClick={handleNext} disabled={!canProceed}>
                  {isLastStep ? (
                    'Get Started'
                  ) : (
                    <>
                      Next
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  return (
    <div className="text-center space-y-4">
      <div className="text-6xl mb-4">🤖</div>
      <h2 className="text-xl font-semibold">Welcome to ClawX</h2>
      <p className="text-slate-300">
        ClawX is a graphical interface for OpenClaw, making it easy to use AI
        assistants across your favorite messaging platforms.
      </p>
      <ul className="text-left space-y-2 text-slate-300">
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Zero command-line required
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Modern, beautiful interface
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Pre-installed skill bundles
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Cross-platform support
        </li>
      </ul>
    </div>
  );
}

interface RuntimeContentProps {
  onStatusChange: (canProceed: boolean) => void;
}

function RuntimeContent({ onStatusChange }: RuntimeContentProps) {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);
  
  const [checks, setChecks] = useState({
    nodejs: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    openclaw: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    gateway: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
  });
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [openclawDir, setOpenclawDir] = useState('');
  
  const runChecks = useCallback(async () => {
    // Reset checks
    setChecks({
      nodejs: { status: 'checking', message: '' },
      openclaw: { status: 'checking', message: '' },
      gateway: { status: 'checking', message: '' },
    });
    
    // Check Node.js — always available in Electron
    setChecks((prev) => ({
      ...prev,
      nodejs: { status: 'success', message: 'Node.js is available (Electron built-in)' },
    }));
    
    // Check OpenClaw package status
    try {
      const openclawStatus = await window.electron.ipcRenderer.invoke('openclaw:status') as {
        packageExists: boolean;
        isBuilt: boolean;
        dir: string;
        version?: string;
      };
      
      setOpenclawDir(openclawStatus.dir);
      
      if (!openclawStatus.packageExists) {
        setChecks((prev) => ({
          ...prev,
          openclaw: { 
            status: 'error', 
            message: `OpenClaw package not found at: ${openclawStatus.dir}` 
          },
        }));
      } else if (!openclawStatus.isBuilt) {
        setChecks((prev) => ({
          ...prev,
          openclaw: { 
            status: 'error', 
            message: 'OpenClaw package found but dist is missing' 
          },
        }));
      } else {
        const versionLabel = openclawStatus.version ? ` v${openclawStatus.version}` : '';
        setChecks((prev) => ({
          ...prev,
          openclaw: { 
            status: 'success', 
            message: `OpenClaw package ready${versionLabel}` 
          },
        }));
      }
    } catch (error) {
      setChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: `Check failed: ${error}` },
      }));
    }
    
    // Check Gateway
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${gatewayStatus.port}` },
      }));
    } else if (gatewayStatus.state === 'starting') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: 'Starting...' },
      }));
    } else {
      setChecks((prev) => ({
        ...prev,
        gateway: { 
          status: 'error', 
          message: gatewayStatus.error || 'Not running' 
        },
      }));
    }
  }, [gatewayStatus]);
  
  useEffect(() => {
    runChecks();
  }, [runChecks]);
  
  // Update canProceed when gateway status changes
  useEffect(() => {
    const allPassed = checks.nodejs.status === 'success' 
      && checks.openclaw.status === 'success' 
      && (checks.gateway.status === 'success' || gatewayStatus.state === 'running');
    onStatusChange(allPassed);
  }, [checks, gatewayStatus, onStatusChange]);
  
  // Update gateway check when gateway status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${gatewayStatus.port}` },
      }));
    } else if (gatewayStatus.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || 'Failed to start' },
      }));
    }
  }, [gatewayStatus]);
  
  const handleStartGateway = async () => {
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: 'Starting...' },
    }));
    await startGateway();
  };
  
  const handleShowLogs = async () => {
    try {
      const logs = await window.electron.ipcRenderer.invoke('log:readFile', 100) as string;
      setLogContent(logs);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const logDir = await window.electron.ipcRenderer.invoke('log:getDir') as string;
      if (logDir) {
        await window.electron.ipcRenderer.invoke('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };
  
  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {message || 'Checking...'}
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-2 text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-2 text-red-400">
        <XCircle className="h-4 w-4" />
        {message}
      </span>
    );
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Checking Environment</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleShowLogs}>
            View Logs
          </Button>
          <Button variant="ghost" size="sm" onClick={runChecks}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Re-check
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Node.js Runtime</span>
          {renderStatus(checks.nodejs.status, checks.nodejs.message)}
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <div>
            <span>OpenClaw Package</span>
            {openclawDir && (
              <p className="text-xs text-slate-500 mt-0.5 font-mono truncate max-w-[300px]">
                {openclawDir}
              </p>
            )}
          </div>
          {renderStatus(checks.openclaw.status, checks.openclaw.message)}
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <div className="flex items-center gap-2">
            <span>Gateway Service</span>
            {checks.gateway.status === 'error' && (
              <Button variant="outline" size="sm" onClick={handleStartGateway}>
                Start Gateway
              </Button>
            )}
          </div>
          {renderStatus(checks.gateway.status, checks.gateway.message)}
        </div>
      </div>
      
      {(checks.nodejs.status === 'error' || checks.openclaw.status === 'error') && (
        <div className="mt-4 p-4 rounded-lg bg-red-900/20 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-400">Environment issue detected</p>
              <p className="text-sm text-slate-300 mt-1">
                Please ensure OpenClaw is properly installed. Check the logs for details.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Log viewer panel */}
      {showLogs && (
        <div className="mt-4 p-4 rounded-lg bg-black/40 border border-slate-600">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-slate-200 text-sm">Application Logs</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleOpenLogDir}>
                <ExternalLink className="h-3 w-3 mr-1" />
                Open Log Folder
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLogs(false)}>
                Close
              </Button>
            </div>
          </div>
          <pre className="text-xs text-slate-300 bg-black/50 p-3 rounded max-h-60 overflow-auto whitespace-pre-wrap font-mono">
            {logContent || '(No logs available yet)'}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ProviderContentProps {
  providers: Provider[];
  selectedProvider: string | null;
  onSelectProvider: (id: string | null) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
}

function ProviderContent({ 
  providers, 
  selectedProvider, 
  onSelectProvider, 
  apiKey, 
  onApiKeyChange 
}: ProviderContentProps) {
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.electron.ipcRenderer.invoke('provider:list') as Array<{ id: string; hasKey: boolean }>;
        const defaultId = await window.electron.ipcRenderer.invoke('provider:getDefault') as string | null;
        const preferred = (defaultId && list.find((p) => p.id === defaultId && p.hasKey)) || list.find((p) => p.hasKey);
        if (preferred && !cancelled) {
          onSelectProvider(preferred.id);
          const storedKey = await window.electron.ipcRenderer.invoke('provider:getApiKey', preferred.id) as string | null;
          if (storedKey) {
            onApiKeyChange(storedKey);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider list:', error);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onApiKeyChange, onSelectProvider]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedProvider) return;
      try {
        const storedKey = await window.electron.ipcRenderer.invoke('provider:getApiKey', selectedProvider) as string | null;
        if (!cancelled && storedKey) {
          onApiKeyChange(storedKey);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider key:', error);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onApiKeyChange, selectedProvider]);
  
  const selectedProviderData = providers.find((p) => p.id === selectedProvider);
  
  const handleValidateKey = async () => {
    if (!apiKey || !selectedProvider) return;
    
    setValidating(true);
    setKeyValid(null);
    
    try {
      // Call real API validation
      const result = await window.electron.ipcRenderer.invoke(
        'provider:validateKey',
        selectedProvider,
        apiKey
      ) as { valid: boolean; error?: string };
      
      setKeyValid(result.valid);
      
      if (result.valid) {
        // Save the API key to both ClawX secure storage and OpenClaw auth-profiles
        try {
          await window.electron.ipcRenderer.invoke(
            'provider:save',
            {
              id: selectedProvider,
              name: selectedProviderData?.name || selectedProvider,
              type: selectedProvider,
              enabled: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            apiKey
          );
        } catch (saveErr) {
          console.warn('Failed to persist API key:', saveErr);
        }
        toast.success('API key validated and saved');
      } else {
        toast.error(result.error || 'Invalid API key');
      }
    } catch (error) {
      setKeyValid(false);
      toast.error('Validation failed: ' + String(error));
    } finally {
      setValidating(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Select AI Provider</h2>
        <p className="text-slate-300">
          Choose your preferred AI model provider
        </p>
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => {
              onSelectProvider(provider.id);
              setKeyValid(null);
            }}
            className={cn(
              'p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all text-center',
              selectedProvider === provider.id && 'ring-2 ring-primary bg-white/10'
            )}
          >
            <span className="text-3xl">{provider.icon}</span>
            <p className="font-medium mt-2">{provider.name}</p>
            <p className="text-sm text-slate-400">{provider.model}</p>
          </button>
        ))}
      </div>
      
      {selectedProvider && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  placeholder={selectedProviderData?.placeholder}
                  value={apiKey}
                  onChange={(e) => {
                    onApiKeyChange(e.target.value);
                    setKeyValid(null);
                  }}
                  autoComplete="off"
                  className="pr-10 bg-white/5 border-white/10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button 
                variant="outline" 
                onClick={handleValidateKey}
                disabled={!apiKey || validating}
              >
                {validating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Validate'
                )}
              </Button>
            </div>
            {keyValid !== null && (
              <p className={cn('text-sm', keyValid ? 'text-green-400' : 'text-red-400')}>
                {keyValid ? '✓ API key is valid' : '✗ Invalid API key'}
              </p>
            )}
          </div>
          
          <p className="text-sm text-slate-400">
            Your API key will be securely stored in the system keychain.
          </p>
        </motion.div>
      )}
    </div>
  );
}

// ==================== Setup Channel Content ====================

function SetupChannelContent() {
  const [selectedChannel, setSelectedChannel] = useState<ChannelType | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const meta: ChannelMeta | null = selectedChannel ? CHANNEL_META[selectedChannel] : null;
  const primaryChannels = getPrimaryChannels();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedChannel) return;
      try {
        const result = await window.electron.ipcRenderer.invoke(
          'channel:getFormValues',
          selectedChannel
        ) as { success: boolean; values?: Record<string, string> };
        if (cancelled) return;
        if (result.success && result.values) {
          setConfigValues(result.values);
        } else {
          setConfigValues({});
        }
      } catch {
        if (!cancelled) {
          setConfigValues({});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedChannel]);

  const isFormValid = () => {
    if (!meta) return false;
    return meta.configFields
      .filter((f: ChannelConfigField) => f.required)
      .every((f: ChannelConfigField) => configValues[f.key]?.trim());
  };

  const handleSave = async () => {
    if (!selectedChannel || !meta || !isFormValid()) return;

    setSaving(true);
    setValidationError(null);

    try {
      // Validate credentials first
      const validation = await window.electron.ipcRenderer.invoke(
        'channel:validateCredentials',
        selectedChannel,
        configValues
      ) as { success: boolean; valid?: boolean; errors?: string[]; details?: Record<string, string> };

      if (!validation.valid) {
        setValidationError((validation.errors || ['Validation failed']).join(', '));
        setSaving(false);
        return;
      }

      // Save config
      await window.electron.ipcRenderer.invoke('channel:saveConfig', selectedChannel, { ...configValues });

      const botName = validation.details?.botUsername ? ` (@${validation.details.botUsername})` : '';
      toast.success(`${meta.name} configured${botName}`);
      setSaved(true);
    } catch (error) {
      setValidationError(String(error));
    } finally {
      setSaving(false);
    }
  };

  // Already saved — show success
  if (saved) {
    return (
      <div className="text-center space-y-4">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-semibold">
          {meta?.name || 'Channel'} Connected
        </h2>
        <p className="text-slate-300">
          Your channel has been configured. It will connect when the Gateway starts.
        </p>
        <Button
          variant="ghost"
          className="text-slate-400"
          onClick={() => {
            setSaved(false);
            setSelectedChannel(null);
            setConfigValues({});
          }}
        >
          Configure another channel
        </Button>
      </div>
    );
  }

  // Channel type not selected — show picker
  if (!selectedChannel) {
    return (
      <div className="space-y-4">
        <div className="text-center mb-2">
          <div className="text-4xl mb-3">📡</div>
          <h2 className="text-xl font-semibold">Connect a Messaging Channel</h2>
          <p className="text-slate-300 text-sm mt-1">
            Choose a platform to connect your AI assistant to. You can add more channels later in Settings.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {primaryChannels.map((type) => {
            const channelMeta = CHANNEL_META[type];
            if (channelMeta.connectionType !== 'token') return null;
            return (
              <button
                key={type}
                onClick={() => setSelectedChannel(type)}
                className="p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all text-left"
              >
                <span className="text-3xl">{channelMeta.icon}</span>
                <p className="font-medium mt-2">{channelMeta.name}</p>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                  {channelMeta.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Channel selected — show config form
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => { setSelectedChannel(null); setConfigValues({}); setValidationError(null); }}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span>{meta?.icon}</span> Configure {meta?.name}
          </h2>
          <p className="text-slate-400 text-sm">{meta?.description}</p>
        </div>
      </div>

      {/* Instructions */}
      <div className="p-3 rounded-lg bg-white/5 text-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-slate-200">How to connect:</p>
          {meta?.docsUrl && (
            <button
              onClick={() => {
                try {
                  window.electron?.openExternal?.(meta.docsUrl!);
                } catch {
                  window.open(meta.docsUrl, '_blank');
                }
              }}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <BookOpen className="h-3 w-3" />
              View docs
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
        <ol className="list-decimal list-inside text-slate-400 space-y-1">
          {meta?.instructions.map((inst, i) => (
            <li key={i}>{inst}</li>
          ))}
        </ol>
      </div>

      {/* Config fields */}
      {meta?.configFields.map((field: ChannelConfigField) => {
        const isPassword = field.type === 'password';
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`setup-${field.key}`} className="text-slate-200">
              {field.label}
              {field.required && <span className="text-red-400 ml-1">*</span>}
            </Label>
            <div className="flex gap-2">
              <Input
                id={`setup-${field.key}`}
                type={isPassword && !showSecrets[field.key] ? 'password' : 'text'}
                placeholder={field.placeholder}
                value={configValues[field.key] || ''}
                onChange={(e) => setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                autoComplete="off"
                className="font-mono text-sm bg-white/5 border-white/10"
              />
              {isPassword && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                >
                  {showSecrets[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
            </div>
            {field.description && (
              <p className="text-xs text-slate-500">{field.description}</p>
            )}
          </div>
        );
      })}

      {/* Validation error */}
      {validationError && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-500/30 text-sm text-red-300 flex items-start gap-2">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Save button */}
      <Button
        className="w-full"
        onClick={handleSave}
        disabled={!isFormValid() || saving}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Validating & Saving...
          </>
        ) : (
          <>
            <Check className="h-4 w-4 mr-2" />
            Validate & Save
          </>
        )}
      </Button>
    </div>
  );
}

// NOTE: SkillsContent component removed - auto-install essential skills

// Installation status for each skill
type InstallStatus = 'pending' | 'installing' | 'completed' | 'failed';

interface SkillInstallState {
  id: string;
  name: string;
  description: string;
  status: InstallStatus;
}

interface InstallingContentProps {
  skills: DefaultSkill[];
  onComplete: (installedSkills: string[]) => void;
  onSkip: () => void;
}

function InstallingContent({ skills, onComplete, onSkip }: InstallingContentProps) {
  const [skillStates, setSkillStates] = useState<SkillInstallState[]>(
    skills.map((s) => ({ ...s, status: 'pending' as InstallStatus }))
  );
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const installStarted = useRef(false);
  
  // Real installation process
  useEffect(() => {
    if (installStarted.current) return;
    installStarted.current = true;
    
    const runRealInstall = async () => {
      try {
        // Step 1: Initialize all skills to 'installing' state for UI
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'installing' })));
        setOverallProgress(10);

        // Step 2: Call the backend to install uv and setup Python
        const result = await window.electron.ipcRenderer.invoke('uv:install-all') as { 
          success: boolean; 
          error?: string 
        };

        if (result.success) {
          setSkillStates(prev => prev.map(s => ({ ...s, status: 'completed' })));
          setOverallProgress(100);
          
          await new Promise((resolve) => setTimeout(resolve, 800));
          onComplete(skills.map(s => s.id));
        } else {
          setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
          setErrorMessage(result.error || 'Unknown error during installation');
          toast.error('Environment setup failed');
        }
      } catch (err) {
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
        setErrorMessage(String(err));
        toast.error('Installation error');
      }
    };
    
    runRealInstall();
  }, [skills, onComplete]);

  const getStatusIcon = (status: InstallStatus) => {
    switch (status) {
      case 'pending':
        return <div className="h-5 w-5 rounded-full border-2 border-slate-500" />;
      case 'installing':
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-400" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-400" />;
    }
  };
  
  const getStatusText = (skill: SkillInstallState) => {
    switch (skill.status) {
      case 'pending':
        return <span className="text-slate-500">Pending</span>;
      case 'installing':
        return <span className="text-primary">Installing...</span>;
      case 'completed':
        return <span className="text-green-400">Installed</span>;
      case 'failed':
        return <span className="text-red-400">Failed</span>;
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-4">⚙️</div>
        <h2 className="text-xl font-semibold mb-2">Installing Essential Components</h2>
        <p className="text-slate-300">
          Setting up the tools needed to power your AI assistant
        </p>
      </div>
      
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Progress</span>
          <span className="text-primary">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>
      
      {/* Skill list */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {skillStates.map((skill) => (
          <motion.div
            key={skill.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg',
              skill.status === 'installing' ? 'bg-white/10' : 'bg-white/5'
            )}
          >
            <div className="flex items-center gap-3">
              {getStatusIcon(skill.status)}
              <div>
                <p className="font-medium">{skill.name}</p>
                <p className="text-xs text-slate-400">{skill.description}</p>
              </div>
            </div>
            {getStatusText(skill)}
          </motion.div>
        ))}
      </div>

      {/* Error Message Display */}
      {errorMessage && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-lg bg-red-900/30 border border-red-500/50 text-red-200 text-sm"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Setup Error:</p>
              <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto whitespace-pre-wrap font-monospace">
                {errorMessage}
              </pre>
              <Button 
                variant="link" 
                className="text-red-400 p-0 h-auto text-xs underline"
                onClick={() => window.location.reload()}
              >
                Try restarting the app
              </Button>
            </div>
          </div>
        </motion.div>
      )}
      
      {!errorMessage && (
        <p className="text-sm text-slate-400 text-center">
          This may take a few moments...
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          className="text-slate-400"
          onClick={onSkip}
        >
          Skip this step
        </Button>
      </div>
    </div>
  );
}
interface CompleteContentProps {
  selectedProvider: string | null;
  installedSkills: string[];
}

function CompleteContent({ selectedProvider, installedSkills }: CompleteContentProps) {
  const gatewayStatus = useGatewayStore((state) => state.status);
  
  const providerData = providers.find((p) => p.id === selectedProvider);
  const installedSkillNames = defaultSkills
    .filter((s) => installedSkills.includes(s.id))
    .map((s) => s.name)
    .join(', ');
  
  return (
    <div className="text-center space-y-6">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-xl font-semibold">Setup Complete!</h2>
      <p className="text-slate-300">
        ClawX is configured and ready to use. You can now start chatting with
        your AI assistant.
      </p>
      
      <div className="space-y-3 text-left max-w-md mx-auto">
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>AI Provider</span>
          <span className="text-green-400">
            {providerData ? `${providerData.icon} ${providerData.name}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Components</span>
          <span className="text-green-400">
            {installedSkillNames || `${installedSkills.length} installed`}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Gateway</span>
          <span className={gatewayStatus.state === 'running' ? 'text-green-400' : 'text-yellow-400'}>
            {gatewayStatus.state === 'running' ? '✓ Running' : gatewayStatus.state}
          </span>
        </div>
      </div>
      
      <p className="text-sm text-slate-400">
        You can customize skills and connect channels in Settings
      </p>
    </div>
  );
}

export default Setup;
