import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class DistributedLockService {
    private readonly logger = new Logger(DistributedLockService.name);
    private readonly lockPrefix = 'taskflow:lock:';

    constructor(@InjectRedis() private readonly redis: Redis) { }

    async acquireLock(resource: string, ttlMs: number = 10000): Promise<string | null> {
        const key = this.lockPrefix + resource;
        const token = this.generateToken();
        try {
            const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
            return ok === 'OK' ? token : null;
        } catch (error) {
            this.logger.warn(`Failed to acquire lock for ${resource}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    async releaseLock(resource: string, token: string): Promise<boolean> {
        const key = this.lockPrefix + resource;
        const lua = `
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
        `;
        try {
            const res = await this.redis.eval(lua, 1, key, token);
            return res === 1;
        } catch (error) {
            this.logger.warn(`Failed to release lock for ${resource}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private generateToken(): string {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
}


