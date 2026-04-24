/**
 * Cron Job Type Definitions
 * Types for scheduled tasks
 */

import { ChannelType } from './channel';

export type CronJobDeliveryMode = 'none' | 'announce';

export interface CronJobDelivery {
  mode: CronJobDeliveryMode;
  channel?: ChannelType | string;
  to?: string;
  accountId?: string;
}

/**
 * Cron job target (where to send the result)
 */
export interface CronJobTarget {
  channelType: ChannelType | string;
  channelId: string;
  channelName: string;
  recipient?: string;
}

/**
 * Cron job last run info
 */
export interface CronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

/**
 * Gateway CronSchedule object format
 */
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

/**
 * Cron job data structure
 * schedule can be a plain cron string or a Gateway CronSchedule object
 */
export interface CronJob {
  id: string;
  name: string;
  message: string;
  schedule: string | CronSchedule;
  delivery?: CronJobDelivery;
  target?: CronJobTarget;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CronJobLastRun;
  nextRun?: string;
  agentId: string;
}

/**
 * Input for creating a cron job from the UI.
 */
export interface CronJobCreateInput {
  name: string;
  message: string;
  schedule: string;
  delivery?: CronJobDelivery;
  enabled?: boolean;
  agentId?: string;
}

/**
 * Input for updating a cron job
 */
export interface CronJobUpdateInput {
  name?: string;
  message?: string;
  schedule?: string;
  delivery?: CronJobDelivery;
  enabled?: boolean;
  agentId?: string;
}

/**
 * Schedule type for UI picker
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';
