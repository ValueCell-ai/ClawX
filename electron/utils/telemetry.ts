import { PostHog } from 'posthog-node';
import { machineIdSync } from 'node-machine-id';
import { app } from 'electron';
import { getSetting, setSetting } from './store';
import { logger } from './logger';

const POSTHOG_API_KEY = 'phc_aGNegeJQP5FzNiF2rEoKqQbkuCpiiETMttplibXpB0n';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let posthogClient: PostHog | null = null;
let distinctId: string = '';

/**
 * Initialize PostHog telemetry
 */
export async function initTelemetry(): Promise<void> {
    try {
        const telemetryEnabled = await getSetting('telemetryEnabled');
        if (!telemetryEnabled) {
            logger.info('Telemetry is disabled in settings');
            return;
        }

        // Initialize PostHog client
        posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });

        // Get or generate machine ID
        distinctId = await getSetting('machineId');
        if (!distinctId) {
            distinctId = machineIdSync();
            await setSetting('machineId', distinctId);
            logger.debug(`Generated new machine ID for telemetry: ${distinctId}`);
        }

        // Common properties for all events
        const properties = {
            $app_version: app.getVersion(),
            $os: process.platform,
            arch: process.arch,
        };

        // Check if this is a new installation
        const hasReportedInstall = await getSetting('hasReportedInstall');
        if (!hasReportedInstall) {
            posthogClient.capture({
                distinctId,
                event: 'app_installed',
                properties,
            });
            await setSetting('hasReportedInstall', true);
            logger.info('Reported app_installed event');
        }

        // Always report app opened
        posthogClient.capture({
            distinctId,
            event: 'app_opened',
            properties,
        });
        logger.debug('Reported app_opened event');

    } catch (error) {
        logger.error('Failed to initialize telemetry:', error);
    }
}

/**
 * Ensure PostHog flushes all pending events before shutting down
 */
export async function shutdownTelemetry(): Promise<void> {
    if (posthogClient) {
        try {
            await posthogClient.shutdown();
            logger.debug('Flushed telemetry events on shutdown');
        } catch (error) {
            logger.error('Error shutting down telemetry:', error);
        }
    }
}
