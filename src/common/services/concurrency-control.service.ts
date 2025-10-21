import { Injectable, Logger } from '@nestjs/common';

interface ConcurrencyLimits {
    [jobType: string]: {
        maxConcurrent: number;
        currentRunning: number;
        queue: Array<() => Promise<void>>;
    };
}

@Injectable()
export class ConcurrencyControlService {
    private readonly logger = new Logger(ConcurrencyControlService.name);
    private readonly limits: ConcurrencyLimits = {
        'task-status-update': { maxConcurrent: 10, currentRunning: 0, queue: [] },
        'batch-status-update': { maxConcurrent: 5, currentRunning: 0, queue: [] },
        'bulk-task-processing': { maxConcurrent: 3, currentRunning: 0, queue: [] },
        'overdue-tasks-notification': { maxConcurrent: 2, currentRunning: 0, queue: [] },
        'dead-letter': { maxConcurrent: 1, currentRunning: 0, queue: [] },
    };

    async acquireSlot(jobType: string): Promise<() => void> {
        const limit = this.limits[jobType];
        if (!limit) {
            this.logger.warn(`No concurrency limit defined for job type: ${jobType}`);
            return () => { }; // No-op release function
        }

        return new Promise((resolve) => {
            const release = () => {
                limit.currentRunning--;
                this.logger.debug(`Released slot for ${jobType}. Current running: ${limit.currentRunning}`);
                this.processQueue(jobType);
            };

            if (limit.currentRunning < limit.maxConcurrent) {
                limit.currentRunning++;
                this.logger.debug(`Acquired slot for ${jobType}. Current running: ${limit.currentRunning}`);
                resolve(release);
            } else {
                this.logger.debug(`Queueing job for ${jobType}. Queue size: ${limit.queue.length + 1}`);
                limit.queue.push(async () => {
                    limit.currentRunning++;
                    this.logger.debug(`Acquired queued slot for ${jobType}. Current running: ${limit.currentRunning}`);
                    resolve(release);
                });
            }
        });
    }

    private processQueue(jobType: string): void {
        const limit = this.limits[jobType];
        if (limit.queue.length > 0 && limit.currentRunning < limit.maxConcurrent) {
            const nextJob = limit.queue.shift();
            if (nextJob) {
                nextJob();
            }
        }
    }

    getStatus(): Record<string, any> {
        const status: Record<string, any> = {};
        for (const [jobType, limit] of Object.entries(this.limits)) {
            status[jobType] = {
                maxConcurrent: limit.maxConcurrent,
                currentRunning: limit.currentRunning,
                queueSize: limit.queue.length,
                utilization: (limit.currentRunning / limit.maxConcurrent) * 100,
            };
        }
        return status;
    }

    updateLimits(jobType: string, maxConcurrent: number): void {
        if (this.limits[jobType]) {
            this.limits[jobType].maxConcurrent = maxConcurrent;
            this.logger.log(`Updated concurrency limit for ${jobType} to ${maxConcurrent}`);
        } else {
            this.logger.warn(`Cannot update limits for unknown job type: ${jobType}`);
        }
    }

    reset(): void {
        for (const limit of Object.values(this.limits)) {
            limit.currentRunning = 0;
            limit.queue.length = 0;
        }
        this.logger.log('Reset all concurrency limits');
    }
}
