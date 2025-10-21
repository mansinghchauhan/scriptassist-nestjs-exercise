import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { RateLimitOptions } from '../../config/rate-limit.config';
import { RedisConnectionService } from './redis-connection.service';
import { RedisPartitioningService } from './redis-partitioning.service';

interface RateLimitResult {
    allowed: boolean;
    limit: number;
    current: number;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
}

@Injectable()
export class RateLimitService {
    private readonly logger = new Logger(RateLimitService.name);
    private readonly keyPrefix = 'rate_limit:';
    private readonly isRedisAvailable: boolean = false;
    private readonly inMemoryStore = new Map<string, { count: number; resetTime: number; limit: number }>();

    constructor(
        private readonly configService: ConfigService,
        @InjectRedis() private readonly redis: Redis,
        private readonly redisConnectionService: RedisConnectionService,
        private readonly redisPartitioningService: RedisPartitioningService,
    ) {
        this.initializeRedisConnection();
    }

    private async initializeRedisConnection(): Promise<void> {
        try {
            // Use the distributed Redis connection service
            if (this.redisConnectionService.isHealthy()) {
                this.logger.log('Rate limiting service connected to distributed Redis');
            } else {
                throw new Error('Redis connection service is not healthy');
            }
        } catch (error) {
            this.logger.warn('Redis not available for rate limiting, using in-memory store:', error instanceof Error ? error.message : String(error));
        }
    }

    async checkRateLimit(
        key: string,
        options: RateLimitOptions,
        identifier?: string,
    ): Promise<RateLimitResult> {
        const fullKey = this.generateKey(key, identifier);

        try {
            if (this.redisConnectionService.isHealthy() && !this.redisConnectionService.isCircuitBreakerOpen()) {
                return await this.checkDistributedRedisRateLimit(fullKey, options);
            } else {
                return this.checkMemoryRateLimit(fullKey, options);
            }
        } catch (error) {
            this.logger.error(`Rate limit check failed for key ${fullKey}:`, error);
            // Fallback to memory-based rate limiting
            return this.checkMemoryRateLimit(fullKey, options);
        }
    }

    private async checkDistributedRedisRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
        // Get the appropriate Redis connection for this key using partitioning
        const redis = this.redisPartitioningService.getConnectionForKey(key);
        return await this.checkRedisRateLimit(key, options, redis);
    }

    private async checkRedisRateLimit(key: string, options: RateLimitOptions, redis?: Redis): Promise<RateLimitResult> {
        const redisClient = redis || this.redis;
        const window = Math.floor(Date.now() / options.windowMs);
        const windowKey = `${key}:${window}`;
        const ttl = Math.ceil(options.windowMs / 1000);

        // Use Redis pipeline for atomic operations
        const pipeline = redisClient.pipeline();
        pipeline.incr(windowKey);
        pipeline.expire(windowKey, ttl);
        pipeline.ttl(windowKey);

        const results = await pipeline.exec();

        if (!results || results.length === 0) {
            throw new Error('Redis pipeline execution failed');
        }

        const currentCount = results[0][1] as number;
        const ttlResult = results[2][1] as number;
        const remaining = Math.max(0, options.limit - currentCount);
        const resetTime = Date.now() + (ttlResult * 1000);

        return {
            allowed: currentCount <= options.limit,
            limit: options.limit,
            current: currentCount,
            remaining,
            resetTime,
            retryAfter: currentCount > options.limit ? Math.ceil((resetTime - Date.now()) / 1000) : undefined,
        };
    }

    private checkMemoryRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
        const now = Date.now();
        const current = this.inMemoryStore.get(key);

        if (!current || now > current.resetTime) {
            // New window or expired window
            const newWindow = {
                count: 1,
                resetTime: now + options.windowMs,
                limit: options.limit,
            };
            this.inMemoryStore.set(key, newWindow);

            return {
                allowed: true,
                limit: options.limit,
                current: 1,
                remaining: options.limit - 1,
                resetTime: newWindow.resetTime,
            };
        }

        current.count++;

        const allowed = current.count <= options.limit;
        const remaining = Math.max(0, options.limit - current.count);

        return {
            allowed,
            limit: options.limit,
            current: current.count,
            remaining,
            resetTime: current.resetTime,
            retryAfter: !allowed ? Math.ceil((current.resetTime - now) / 1000) : undefined,
        };
    }

    async resetRateLimit(key: string, identifier?: string): Promise<void> {
        const fullKey = this.generateKey(key, identifier);

        try {
            if (this.redisConnectionService.isHealthy() && !this.redisConnectionService.isCircuitBreakerOpen()) {
                await this.resetDistributedRedisRateLimit(fullKey);
            } else {
                this.resetMemoryRateLimit(fullKey);
            }
        } catch (error) {
            this.logger.error(`Failed to reset rate limit for key ${fullKey}:`, error);
        }
    }

    private async resetDistributedRedisRateLimit(key: string): Promise<void> {
        const redis = this.redisPartitioningService.getConnectionForKey(key);
        await this.resetRedisRateLimit(key, redis);
    }

    private async resetRedisRateLimit(key: string, redis?: Redis): Promise<void> {
        const redisClient = redis || this.redis;
        const pattern = `${key}:*`;
        const keys = await redisClient.keys(pattern);

        if (keys.length > 0) {
            await redisClient.del(...keys);
        }
    }

    private resetMemoryRateLimit(key: string): void {
        this.inMemoryStore.delete(key);
    }

    async getRateLimitInfo(key: string, identifier?: string): Promise<Partial<RateLimitResult>> {
        const fullKey = this.generateKey(key, identifier);

        try {
            if (this.redisConnectionService.isHealthy() && !this.redisConnectionService.isCircuitBreakerOpen()) {
                return await this.getDistributedRedisRateLimitInfo(fullKey);
            } else {
                return this.getMemoryRateLimitInfo(fullKey);
            }
        } catch (error) {
            this.logger.error(`Failed to get rate limit info for key ${fullKey}:`, error);
            return {};
        }
    }

    private async getDistributedRedisRateLimitInfo(key: string): Promise<Partial<RateLimitResult>> {
        const redis = this.redisPartitioningService.getConnectionForKey(key);
        return await this.getRedisRateLimitInfo(key, redis);
    }

    private async getRedisRateLimitInfo(key: string, redis?: Redis): Promise<Partial<RateLimitResult>> {
        const redisClient = redis || this.redis;
        const pattern = `${key}:*`;
        const keys = await redisClient.keys(pattern);

        if (keys.length === 0) {
            return { current: 0, remaining: 0 };
        }

        const pipeline = redisClient.pipeline();
        keys.forEach(k => pipeline.get(k));
        keys.forEach(k => pipeline.ttl(k));

        const results = await pipeline.exec();

        if (!results || results.length === 0) {
            return { current: 0, remaining: 0 };
        }

        let totalCount = 0;
        let minTtl = Infinity;

        for (let i = 0; i < results.length; i += 2) {
            const count = parseInt(results[i][1] as string || '0', 10);
            const ttl = results[i + 1][1] as number;

            totalCount += count;
            minTtl = Math.min(minTtl, ttl);
        }

        return {
            current: totalCount,
            resetTime: minTtl > 0 ? Date.now() + (minTtl * 1000) : undefined,
        };
    }

    private getMemoryRateLimitInfo(key: string): Partial<RateLimitResult> {
        const current = this.inMemoryStore.get(key);

        if (!current) {
            return { current: 0, remaining: 0 };
        }

        const now = Date.now();

        if (now > current.resetTime) {
            return { current: 0, remaining: 0 };
        }

        return {
            current: current.count,
            remaining: Math.max(0, current.limit - current.count),
            resetTime: current.resetTime,
        };
    }

    private generateKey(key: string, identifier?: string): string {
        const baseKey = identifier ? `${key}:${identifier}` : key;
        return `${this.keyPrefix}${baseKey}`;
    }


    // Cleanup method for in-memory store
    cleanup(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];

        for (const [key, value] of this.inMemoryStore.entries()) {
            if (now > value.resetTime) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.inMemoryStore.delete(key));

        if (keysToDelete.length > 0) {
            this.logger.debug(`Cleaned up ${keysToDelete.length} expired rate limit entries`);
        }
    }
}
