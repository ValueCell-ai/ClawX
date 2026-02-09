/**
 * Dashboard Page
 * Main overview page showing system status and quick actions
 */
import { useEffect, useState } from 'react';
import {
  Activity,
  MessageSquare,
  Radio,
  Puzzle,
  Clock,
  Settings,
  Plus,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useGatewayStore } from '@/stores/gateway';
import { useChannelsStore } from '@/stores/channels';
import { useSkillsStore } from '@/stores/skills';
import { StatusBadge } from '@/components/common/StatusBadge';

export function Dashboard() {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const { channels, fetchChannels } = useChannelsStore();
  const { skills, fetchSkills } = useSkillsStore();
  
  const isGatewayRunning = gatewayStatus.state === 'running';
  const [uptime, setUptime] = useState(0);
  
  // Fetch data only when gateway is running
  useEffect(() => {
    if (isGatewayRunning) {
      fetchChannels();
      fetchSkills();
    }
  }, [fetchChannels, fetchSkills, isGatewayRunning]);
  
  // Calculate statistics safely
  const connectedChannels = Array.isArray(channels) ? channels.filter((c) => c.status === 'connected').length : 0;
  const enabledSkills = Array.isArray(skills) ? skills.filter((s) => s.enabled).length : 0;
  
  // Update uptime periodically
  useEffect(() => {
    const updateUptime = () => {
      if (gatewayStatus.connectedAt) {
        setUptime(Math.floor((Date.now() - gatewayStatus.connectedAt) / 1000));
      } else {
        setUptime(0);
      }
    };
    
    // Update immediately
    updateUptime();
    
    // Update every second
    const interval = setInterval(updateUptime, 1000);
    
    return () => clearInterval(interval);
  }, [gatewayStatus.connectedAt]);
  
  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Gateway Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Gateway</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusBadge status={gatewayStatus.state} />
            </div>
            {gatewayStatus.state === 'running' && (
              <p className="mt-1 text-xs text-muted-foreground">
                Port: {gatewayStatus.port} | PID: {gatewayStatus.pid || 'N/A'}
              </p>
            )}
          </CardContent>
        </Card>
        
        {/* Channels */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Channels</CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{connectedChannels}</div>
            <p className="text-xs text-muted-foreground">
              {connectedChannels} of {channels.length} connected
            </p>
          </CardContent>
        </Card>
        
        {/* Skills */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Skills</CardTitle>
            <Puzzle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enabledSkills}</div>
            <p className="text-xs text-muted-foreground">
              {enabledSkills} of {skills.length} enabled
            </p>
          </CardContent>
        </Card>
        
        {/* Uptime */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {uptime > 0 ? formatUptime(uptime) : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              {gatewayStatus.state === 'running' ? 'Since last restart' : 'Gateway not running'}
            </p>
          </CardContent>
        </Card>
      </div>
      
      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks and shortcuts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/channels">
                <Plus className="h-5 w-5" />
                <span>Add Channel</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/skills">
                <Puzzle className="h-5 w-5" />
                <span>Browse Skills</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/">
                <MessageSquare className="h-5 w-5" />
                <span>Open Chat</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/settings">
                <Settings className="h-5 w-5" />
                <span>Settings</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Recent Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Connected Channels */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Connected Channels</CardTitle>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Radio className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No channels configured</p>
                <Button variant="link" asChild className="mt-2">
                  <Link to="/channels">Add your first channel</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {channels.slice(0, 5).map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {channel.type === 'whatsapp' && '📱'}
                        {channel.type === 'telegram' && '✈️'}
                        {channel.type === 'discord' && '🎮'}
                        {channel.type === 'slack' && '💼'}
                      </span>
                      <div>
                        <p className="font-medium">{channel.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {channel.type}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={channel.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Enabled Skills */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Skills</CardTitle>
          </CardHeader>
          <CardContent>
            {skills.filter((s) => s.enabled).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Puzzle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No skills enabled</p>
                <Button variant="link" asChild className="mt-2">
                  <Link to="/skills">Enable some skills</Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {skills
                  .filter((s) => s.enabled)
                  .slice(0, 12)
                  .map((skill) => (
                    <Badge key={skill.id} variant="secondary">
                      {skill.icon && <span className="mr-1">{skill.icon}</span>}
                      {skill.name}
                    </Badge>
                  ))}
                {skills.filter((s) => s.enabled).length > 12 && (
                  <Badge variant="outline">
                    +{skills.filter((s) => s.enabled).length - 12} more
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export default Dashboard;
