/* istanbul ignore file */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Cluster, RedisOptions } from 'ioredis';
import { RedisClusterConfig } from '../../config/redis.config';

export interface ConnectionHealth {
    isConnected: boolean;
    latency: number;
    lastError?: string;
    nodeCount?: number;
    clusterState?: string;
}

@Injectable()
export class RedisConnectionService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisConnectionService.name);
    private redis: Redis | Cluster;
    private isConnected = false;
    private connectionHealth: ConnectionHealth = {
        isConnected: false,
        latency: 0,
    };
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 1000;
    private healthCheckInterval: NodeJS.Timeout;
    private circuitBreakerOpen = false;
    private circuitBreakerFailures = 0;
    private circuitBreakerThreshold = 5;
    private circuitBreakerTimeout = 30000; // 30 seconds

    constructor(private readonly configService: ConfigService) { }

    async onModuleInit() {
        await this.initializeConnection();
        this.startHealthCheck();
    }

    onModuleDestroy() {
        this.stopHealthCheck();
        this.disconnect();
    }

    private async initializeConnection(): Promise<void> {
        try {
            const config = this.configService.get<RedisClusterConfig>('redis');

            if (!config) {
                throw new Error('Redis configuration not found');
            }

            this.logger.log(`Initializing Redis connection (type: ${config.type})`);

            switch (config.type) {
                case 'cluster':
                    this.redis = this.createClusterConnection(config);
                    break;
                case 'sentinel':
                    this.redis = this.createSentinelConnection(config);
                    break;
                default:
                    this.redis = this.createSingleConnection(config);
            }

            this.setupEventHandlers();
            await this.testConnection();

        } catch (error) {
            this.logger.error('Failed to initialize Redis connection:', error);
            this.handleConnectionError(error);
        }
    }

    private createClusterConnection(config: RedisClusterConfig): Cluster {
        return new Redis.Cluster(config.options.nodes!, {
            // Cluster-specific options
            scaleReads: config.options.scaleReads || 'slave',
            maxRedirections: config.options.maxRedirections || 16,
            retryDelayOnClusterDown: config.options.retryDelayOnClusterDown || 300,
            retryDelayOnFailover: config.options.retryDelayOnFailover || 100,
            enableOfflineQueue: config.options.enableOfflineQueue || false,


            // Redis options for individual connections
            redisOptions: {
                password: config.options.redisOptions?.password,
                tls: config.options.redisOptions?.tls,
                connectTimeout: config.options.connectTimeout || 10000,
                commandTimeout: config.options.commandTimeout || 5000,
                family: config.options.family || 4,
                ...(config.options.keepAlive === false ? {} : { keepAlive: 0 }),
                noDelay: config.options.noDelay !== false,
                connectionName: config.options.connectionName || 'taskflow-cluster',
                enableReadyCheck: config.options.enableReadyCheck !== false,
                maxRetriesPerRequest: config.options.maxRetriesPerRequest || 3,
                lazyConnect: config.options.lazyConnect !== false,

            },
        });
    }

    private createSentinelConnection(config: RedisClusterConfig): Redis {
        return new Redis({
            // Sentinel-specific options
            sentinels: config.options.sentinels!,
            name: config.options.name!,


            // Common connection options
            connectTimeout: config.options.connectTimeout || 10000,
            commandTimeout: config.options.commandTimeout || 5000,
            family: config.options.family || 4,
            ...(config.options.keepAlive === false ? {} : { keepAlive: 0 }),
            noDelay: config.options.noDelay !== false,
            connectionName: config.options.connectionName || 'taskflow-sentinel',
            enableReadyCheck: config.options.enableReadyCheck !== false,
            maxRetriesPerRequest: config.options.maxRetriesPerRequest || 3,
            lazyConnect: config.options.lazyConnect !== false,

            password: config.options.password,
            tls: config.options.tls,
        });
    }

    private createSingleConnection(config: RedisClusterConfig): Redis {
        return new Redis({
            host: config.options.host!,
            port: config.options.port!,
            password: config.options.password,
            db: config.options.db || 0,
            connectTimeout: config.options.connectTimeout || 10000,
            commandTimeout: config.options.commandTimeout || 5000,
            family: config.options.family || 4,
            ...(config.options.keepAlive === false ? {} : { keepAlive: 0 }),
            noDelay: config.options.noDelay !== false,
            connectionName: config.options.connectionName || 'taskflow-single',
            enableReadyCheck: config.options.enableReadyCheck !== false,
            maxRetriesPerRequest: config.options.maxRetriesPerRequest || 3,
            lazyConnect: config.options.lazyConnect !== false,

            tls: config.options.tls,
        });
    }

    private setupEventHandlers(): void {
        this.redis.on('connect', () => {
            this.logger.log('Redis connected');
            this.isConnected = true;
            this.connectionHealth.isConnected = true;
            this.reconnectAttempts = 0;
            this.circuitBreakerOpen = false;
            this.circuitBreakerFailures = 0;
        });

        this.redis.on('ready', () => {
            this.logger.log('Redis ready');
            this.isConnected = true;
            this.connectionHealth.isConnected = true;
        });

        this.redis.on('error', (error) => {
            this.logger.error('Redis error:', error);
            this.handleConnectionError(error);
        });

        this.redis.on('close', () => {
            this.logger.warn('Redis connection closed');
            this.isConnected = false;
            this.connectionHealth.isConnected = false;
            this.attemptReconnect();
        });

        this.redis.on('reconnecting', () => {
            this.logger.log('Redis reconnecting...');
            this.reconnectAttempts++;
        });

        // Cluster-specific events
        if (this.redis instanceof Redis.Cluster) {
            this.redis.on('+node', (node) => {
                this.logger.log(`Redis cluster node added: ${node.options.host}:${node.options.port}`);
            });

            this.redis.on('-node', (node) => {
                this.logger.warn(`Redis cluster node removed: ${node.options.host}:${node.options.port}`);
            });

            this.redis.on('node error', (error, node) => {
                this.logger.error(`Redis cluster node error: ${node.options.host}:${node.options.port}`, error);
            });
        }
    }

    private async testConnection(): Promise<void> {
        try {
            const start = Date.now();
            await this.redis.ping();
            const latency = Date.now() - start;

            this.connectionHealth.latency = latency;
            this.isConnected = true;
            this.connectionHealth.isConnected = true;

            this.logger.log(`Redis connection test successful (latency: ${latency}ms)`);
        } catch (error) {
            this.logger.error('Redis connection test failed:', error);
            throw error;
        }
    }

    private handleConnectionError(error: any): void {
        this.isConnected = false;
        this.connectionHealth.isConnected = false;
        this.connectionHealth.lastError = error.message;
        this.circuitBreakerFailures++;

        if (this.circuitBreakerFailures >= this.circuitBreakerThreshold) {
            this.circuitBreakerOpen = true;
            this.logger.error(`Circuit breaker opened after ${this.circuitBreakerFailures} failures`);

            // Reset circuit breaker after timeout
            setTimeout(() => {
                this.circuitBreakerOpen = false;
                this.circuitBreakerFailures = 0;
                this.logger.log('Circuit breaker reset');
            }, this.circuitBreakerTimeout);
        }
    }

    private async attemptReconnect(): Promise<void> {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error('Max reconnection attempts reached');
            return;
        }

        if (this.circuitBreakerOpen) {
            this.logger.warn('Circuit breaker is open, skipping reconnection attempt');
            return;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.logger.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

        setTimeout(async () => {
            try {
                await this.initializeConnection();
            } catch (error) {
                this.logger.error('Reconnection attempt failed:', error);
                this.attemptReconnect();
            }
        }, delay);
    }

    private startHealthCheck(): void {
        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthCheck();
        }, 30000); // Check every 30 seconds
    }

    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }

    private async performHealthCheck(): Promise<void> {
        if (this.circuitBreakerOpen) {
            return;
        }

        try {
            const start = Date.now();
            await this.redis.ping();
            const latency = Date.now() - start;

            this.connectionHealth.latency = latency;
            this.connectionHealth.isConnected = true;
            this.isConnected = true;

            // Reset failure count on successful health check
            this.circuitBreakerFailures = 0;

        } catch (error) {
            this.logger.warn('Health check failed:', error);
            this.handleConnectionError(error);
        }
    }

    getConnection(): Redis | Cluster {
        if (this.circuitBreakerOpen) {
            throw new Error('Redis circuit breaker is open');
        }
        return this.redis;
    }

    isHealthy(): boolean {
        return this.isConnected && !this.circuitBreakerOpen;
    }

    getHealthStatus(): ConnectionHealth {
        return {
            ...this.connectionHealth,
            nodeCount: this.redis instanceof Redis.Cluster ? this.redis.nodes().length : 1,
            clusterState: this.redis instanceof Redis.Cluster ? this.redis.status : 'single',
        };
    }

    async disconnect(): Promise<void> {
        if (this.redis) {
            await this.redis.disconnect();
            this.isConnected = false;
            this.connectionHealth.isConnected = false;
        }
    }

    // Circuit breaker methods
    isCircuitBreakerOpen(): boolean {
        return this.circuitBreakerOpen;
    }

    resetCircuitBreaker(): void {
        this.circuitBreakerOpen = false;
        this.circuitBreakerFailures = 0;
        this.logger.log('Circuit breaker manually reset');
    }
}
