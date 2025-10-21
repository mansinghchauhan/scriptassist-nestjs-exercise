/* istanbul ignore file */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { RedisConnectionService } from './redis-connection.service';
import { RedisPartitioningService } from './redis-partitioning.service';

interface CacheItem {
    value: any;
    expiresAt: number;
}

@Injectable()
export class CacheService implements OnModuleInit {
    private readonly logger = new Logger(CacheService.name);
    private readonly keyPrefix = 'taskflow:cache:';
    private readonly maxCacheSize = 10000;
    private readonly cleanupInterval = 60000; // 1 minute
    private cache: Map<string, CacheItem> = new Map();
    private cleanupTimer: NodeJS.Timeout | null = null;
    private isRedisAvailable = false;
    private pubSubChannel = 'taskflow:cache:invalidation';
    private redisSubscriber: Redis | null = null;

    constructor(
        private readonly configService: ConfigService,
        @InjectRedis() private readonly redis: Redis,
        private readonly redisConnectionService: RedisConnectionService,
        private readonly redisPartitioningService: RedisPartitioningService,
    ) { }

    async onModuleInit() {
        // Start periodic cleanup for in-memory cache
        this.startCleanupTimer();

        // Test Redis connection using distributed service
        try {
            if (this.redisConnectionService.isHealthy()) {
                this.isRedisAvailable = true;
                this.logger.log('Distributed Redis cache enabled and connected');
                await this.initializePubSub();
            } else {
                throw new Error('Redis connection service is not healthy');
            }
        } catch (error) {
            this.isRedisAvailable = false;
            this.logger.warn('Redis not available, using in-memory cache:', error instanceof Error ? error.message : String(error));
        }
    }

    async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
        try {
            const prefixedKey = this.getPrefixedKey(key);
            const expiresAt = Date.now() + (ttlSeconds * 1000);

            if (this.isRedisAvailable && !this.redisConnectionService.isCircuitBreakerOpen()) {
                await this.setDistributedRedis(prefixedKey, value, ttlSeconds);
            } else {
                this.setMemory(prefixedKey, value, expiresAt);
            }

            this.logger.debug(`Cache set: ${key} (TTL: ${ttlSeconds}s)`);
        } catch (error) {
            this.logger.error(`Failed to set cache key ${key}:`, error);
            // Fallback to memory cache if Redis fails
            if (this.isRedisAvailable) {
                const prefixedKey = this.getPrefixedKey(key);
                const expiresAt = Date.now() + (ttlSeconds * 1000);
                this.setMemory(prefixedKey, value, expiresAt);
            }
        }
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const prefixedKey = this.getPrefixedKey(key);

            if (this.isRedisAvailable) {
                return await this.getRedis<T>(prefixedKey);
            } else {
                return this.getMemory<T>(prefixedKey);
            }
        } catch (error) {
            this.logger.error(`Failed to get cache key ${key}:`, error);
            return null;
        }
    }

    async delete(key: string): Promise<boolean> {
        try {
            const prefixedKey = this.getPrefixedKey(key);

            if (this.isRedisAvailable) {
                return await this.deleteRedis(prefixedKey);
            } else {
                return this.deleteMemory(prefixedKey);
            }
        } catch (error) {
            this.logger.error(`Failed to delete cache key ${key}:`, error);
            return false;
        }
    }

    async mget<T>(keys: string[]): Promise<(T | null)[]> {
        try {
            const prefixedKeys = keys.map(key => this.getPrefixedKey(key));

            if (this.isRedisAvailable) {
                return await this.mgetRedis<T>(prefixedKeys);
            } else {
                return prefixedKeys.map(key => this.getMemory<T>(key));
            }
        } catch (error) {
            this.logger.error(`Failed to get multiple cache keys:`, error);
            return keys.map(() => null);
        }
    }

    async mset(keyValuePairs: Record<string, any>, ttlSeconds = 300): Promise<void> {
        try {
            if (this.isRedisAvailable) {
                await this.msetRedis(keyValuePairs, ttlSeconds);
            } else {
                const now = Date.now() + (ttlSeconds * 1000);
                for (const [key, value] of Object.entries(keyValuePairs)) {
                    const prefixedKey = this.getPrefixedKey(key);
                    this.setMemory(prefixedKey, value, now);
                }
            }

            this.logger.debug(`Cache mset: ${Object.keys(keyValuePairs).length} keys`);
        } catch (error) {
            this.logger.error('Failed to set multiple cache keys:', error);
        }
    }

    async invalidatePattern(pattern: string): Promise<void> {
        try {
            if (this.isRedisAvailable) {
                await this.invalidatePatternRedis(pattern);
                await this.publishInvalidation(pattern);
            } else {
                this.invalidatePatternMemory(pattern);
            }
        } catch (error) {
            this.logger.error(`Failed to invalidate pattern ${pattern}:`, error);
        }
    }

    async clear(): Promise<void> {
        try {
            if (this.isRedisAvailable) {
                await this.clearRedis();
            } else {
                this.cache.clear();
            }
            this.logger.log('Cache cleared');
        } catch (error) {
            this.logger.error('Failed to clear cache:', error);
        }
    }

    async getStats(): Promise<{
        totalKeys: number;
        memoryUsage: string;
        hitRate?: number;
        type: 'redis' | 'memory';
    }> {
        try {
            if (this.isRedisAvailable) {
                return await this.getRedisStats();
            } else {
                return this.getMemoryStats();
            }
        } catch (error) {
            this.logger.error('Failed to get cache stats:', error);
            return {
                totalKeys: 0,
                memoryUsage: 'unknown',
                type: this.isRedisAvailable ? 'redis' : 'memory'
            };
        }
    }

    // Distributed Redis methods
    private async setDistributedRedis(key: string, value: any, ttlSeconds: number): Promise<void> {
        const redis = this.redisPartitioningService.getConnectionForKey(key);
        await this.setRedis(key, value, ttlSeconds, redis);
    }

    // Redis methods
    private async setRedis(key: string, value: any, ttlSeconds: number, redis?: Redis): Promise<void> {
        const redisClient = redis || this.redis;
        const serializedValue = JSON.stringify(value);
        await redisClient.setex(key, ttlSeconds, serializedValue);
    }

    private async getRedis<T>(key: string): Promise<T | null> {
        const value = await this.redis.get(key);
        if (value === null) {
            return null;
        }
        try {
            return JSON.parse(value) as T;
        } catch (error) {
            this.logger.error(`Failed to parse cached value for key ${key}:`, error);
            return null;
        }
    }

    private async deleteRedis(key: string): Promise<boolean> {
        const result = await this.redis.del(key);
        return result > 0;
    }

    private async mgetRedis<T>(keys: string[]): Promise<(T | null)[]> {
        const values = await this.redis.mget(...keys);
        return values.map(value => {
            if (value === null) {
                return null;
            }
            try {
                return JSON.parse(value) as T;
            } catch (error) {
                this.logger.error(`Failed to parse cached value:`, error);
                return null;
            }
        });
    }

    private async msetRedis(keyValuePairs: Record<string, any>, ttlSeconds: number): Promise<void> {
        const pipeline = this.redis.pipeline();

        for (const [key, value] of Object.entries(keyValuePairs)) {
            const serializedValue = JSON.stringify(value);
            pipeline.setex(key, ttlSeconds, serializedValue);
        }

        await pipeline.exec();
    }

    private async invalidatePatternRedis(pattern: string): Promise<void> {
        const prefixedPattern = this.getPrefixedKey(pattern);
        const keys = await this.redis.keys(prefixedPattern);

        if (keys.length > 0) {
            await this.redis.del(...keys);
        }
    }

    private async initializePubSub(): Promise<void> {
        try {
            // Create a dedicated subscriber connection
            this.redisSubscriber = this.redis.duplicate();
            await this.redisSubscriber.connect();

            await this.redisSubscriber.subscribe(this.pubSubChannel);
            this.redisSubscriber.on('message', (channel: string, message: string) => {
                if (channel !== this.pubSubChannel) return;
                try {
                    const payload = JSON.parse(message) as { pattern: string };
                    // Invalidate local caches matching the pattern
                    this.invalidatePatternMemory(payload.pattern);
                    // Best-effort: also delete matching keys from this node's Redis connection
                    // to minimize stale reads from non-partitioned keys
                    this.invalidatePatternRedis(payload.pattern).catch((err) => {
                        this.logger.warn('Redis pattern invalidation from pub/sub failed:', err instanceof Error ? err.message : String(err));
                    });
                } catch (err) {
                    this.logger.warn('Failed to process cache invalidation message:', err instanceof Error ? err.message : String(err));
                }
            });

            this.logger.log(`Subscribed to cache invalidation channel: ${this.pubSubChannel}`);
        } catch (error) {
            this.logger.warn('Failed to initialize Redis pub/sub for cache invalidation:', error instanceof Error ? error.message : String(error));
            // Pub/Sub is optional; continue without it
        }
    }

    private async publishInvalidation(pattern: string): Promise<void> {
        try {
            const payload = JSON.stringify({ pattern });
            await this.redis.publish(this.pubSubChannel, payload);
        } catch (error) {
            this.logger.warn('Failed to publish cache invalidation event:', error instanceof Error ? error.message : String(error));
        }
    }

    private async clearRedis(): Promise<void> {
        const pattern = this.getPrefixedKey('*');
        const keys = await this.redis.keys(pattern);

        if (keys.length > 0) {
            await this.redis.del(...keys);
        }
    }

    private async getRedisStats(): Promise<{
        totalKeys: number;
        memoryUsage: string;
        hitRate?: number;
        type: 'redis' | 'memory';
    }> {
        const info = await this.redis.info('memory');
        const keyspace = await this.redis.info('keyspace');

        // Parse Redis info output
        const memoryMatch = info.match(/used_memory_human:(.+)/);
        const memoryUsage = memoryMatch ? memoryMatch[1].trim() : 'unknown';

        const keyspaceMatch = keyspace.match(/db\d+:keys=(\d+)/);
        const totalKeys = keyspaceMatch ? parseInt(keyspaceMatch[1], 10) : 0;

        return {
            totalKeys,
            memoryUsage,
            type: 'redis' as const,
        };
    }

    // Memory cache methods
    private setMemory(key: string, value: any, expiresAt: number): void {
        this.cache.set(key, { value, expiresAt });
    }

    private getMemory<T>(key: string): T | null {
        const item = this.cache.get(key);

        if (!item) {
            return null;
        }

        if (item.expiresAt < Date.now()) {
            this.cache.delete(key);
            return null;
        }

        return item.value as T;
    }

    private deleteMemory(key: string): boolean {
        return this.cache.delete(key);
    }

    private invalidatePatternMemory(pattern: string): void {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        const keysToDelete: string[] = [];

        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.cache.delete(key));
    }

    private getMemoryStats(): any {
        // Clean up expired keys
        this.cleanup();

        return {
            totalKeys: this.cache.size,
            memoryUsage: this.estimateMemoryUsage(),
            type: 'memory' as const
        };
    }

    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);
    }

    private cleanup(): void {
        const now = Date.now();
        const entries = Array.from(this.cache.entries());
        let removedCount = 0;

        // Remove expired entries
        entries.forEach(([key, item]) => {
            if (item.expiresAt < now) {
                this.cache.delete(key);
                removedCount++;
            }
        });

        // If still over limit, remove oldest entries
        if (this.cache.size > this.maxCacheSize) {
            const sortedEntries = entries
                .filter(([key]) => this.cache.has(key)) // Only existing entries
                .sort((a, b) => a[1].expiresAt - b[1].expiresAt);

            const toRemove = sortedEntries.slice(0, this.cache.size - this.maxCacheSize);
            toRemove.forEach(([key]) => {
                this.cache.delete(key);
                removedCount++;
            });
        }

        if (removedCount > 0) {
            this.logger.debug(`Cache cleanup: removed ${removedCount} entries`);
        }
    }

    private estimateMemoryUsage(): string {
        const size = this.cache.size;
        const avgItemSize = 1024; // Rough estimate
        const totalBytes = size * avgItemSize;

        if (totalBytes < 1024) {
            return `${totalBytes} B`;
        } else if (totalBytes < 1024 * 1024) {
            return `${(totalBytes / 1024).toFixed(2)} KB`;
        } else {
            return `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
        }
    }

    private getPrefixedKey(key: string): string {
        if (!key || typeof key !== 'string') {
            throw new Error('Invalid cache key');
        }

        const sanitizedKey = key.replace(/[^a-zA-Z0-9:_-]/g, '_');
        return `${this.keyPrefix}${sanitizedKey}`;
    }

    onModuleDestroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        if (this.redisSubscriber) {
            try {
                this.redisSubscriber.disconnect();
            } catch (_) { }
            this.redisSubscriber = null;
        }
    }
}
