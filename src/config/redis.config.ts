import { registerAs } from '@nestjs/config';

export interface RedisClusterConfig {
    type: 'single' | 'cluster' | 'sentinel';
    options: {
        // Single instance options
        host?: string;
        port?: number;
        password?: string;
        db?: number;

        // Cluster options
        nodes?: Array<{ host: string; port: number }>;
        scaleReads?: 'master' | 'slave' | 'all';
        maxRedirections?: number;
        retryDelayOnClusterDown?: number;
        retryDelayOnFailover?: number;
        enableOfflineQueue?: boolean;
        redisOptions?: {
            password?: string;
            tls?: {
                servername?: string;
                rejectUnauthorized?: boolean;
            };
        };

        // Sentinel options
        sentinels?: Array<{ host: string; port: number }>;
        name?: string;
        sentinelRetryDelayOnFailover?: number;
        sentinelRetryDelayOnClusterDown?: number;

        // Common options
        connectTimeout?: number;
        commandTimeout?: number;
        family?: 4 | 6;
        keepAlive?: boolean;
        noDelay?: boolean;
        connectionName?: string;
        enableReadyCheck?: boolean;
        maxRetriesPerRequest?: number;
        lazyConnect?: boolean;
        maxLoadingTimeout?: number;

        // Security options
        tls?: {
            servername?: string;
            rejectUnauthorized?: boolean;
        };
    };
}

export default registerAs('redis', (): RedisClusterConfig => {
    const isCluster = process.env.REDIS_CLUSTER === 'true';
    const isSentinel = process.env.REDIS_SENTINEL === 'true';

    if (isCluster) {
        const nodes = [
            { host: process.env.REDIS_NODE1_HOST || 'localhost', port: parseInt(process.env.REDIS_NODE1_PORT || '7000', 10) },
            { host: process.env.REDIS_NODE2_HOST || 'localhost', port: parseInt(process.env.REDIS_NODE2_PORT || '7001', 10) },
            { host: process.env.REDIS_NODE3_HOST || 'localhost', port: parseInt(process.env.REDIS_NODE3_PORT || '7002', 10) },
        ];

        // Validate that we have at least 3 nodes for a proper cluster
        if (nodes.length < 3) {
            throw new Error('Redis cluster requires at least 3 nodes');
        }

        return {
            type: 'cluster',
            options: {
                nodes,
                scaleReads: (process.env.REDIS_CLUSTER_SCALE_READS as 'master' | 'slave' | 'all') || 'slave',
                maxRedirections: parseInt(process.env.REDIS_CLUSTER_MAX_REDIRECTIONS || '16', 10),
                retryDelayOnClusterDown: parseInt(process.env.REDIS_CLUSTER_RETRY_DELAY_ON_CLUSTER_DOWN || '300', 10),
                retryDelayOnFailover: parseInt(process.env.REDIS_CLUSTER_RETRY_DELAY_ON_FAILOVER || '100', 10),
                enableOfflineQueue: process.env.REDIS_CLUSTER_ENABLE_OFFLINE_QUEUE === 'true',
                connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
                commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10),
                family: parseInt(process.env.REDIS_FAMILY || '4', 10) as 4 | 6,
                keepAlive: process.env.REDIS_KEEP_ALIVE !== 'false',
                noDelay: process.env.REDIS_NO_DELAY !== 'false',
                connectionName: process.env.REDIS_CONNECTION_NAME || 'taskflow-cluster',
                enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK !== 'false',
                maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '3', 10),
                lazyConnect: process.env.REDIS_LAZY_CONNECT !== 'false',
                maxLoadingTimeout: parseInt(process.env.REDIS_MAX_LOADING_TIMEOUT || '10000', 10),
                redisOptions: {
                    password: process.env.REDIS_PASSWORD,
                    tls: process.env.REDIS_TLS === 'true' ? {
                        servername: process.env.REDIS_TLS_SERVERNAME,
                        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
                    } : undefined,
                },
            },
        };
    }

    if (isSentinel) {
        const sentinels = [
            { host: process.env.REDIS_SENTINEL1_HOST || 'localhost', port: parseInt(process.env.REDIS_SENTINEL1_PORT || '26379', 10) },
            { host: process.env.REDIS_SENTINEL2_HOST || 'localhost', port: parseInt(process.env.REDIS_SENTINEL2_PORT || '26380', 10) },
            { host: process.env.REDIS_SENTINEL3_HOST || 'localhost', port: parseInt(process.env.REDIS_SENTINEL3_PORT || '26381', 10) },
        ];

        // Validate that we have at least 3 sentinels for proper quorum
        if (sentinels.length < 3) {
            throw new Error('Redis sentinel requires at least 3 sentinel nodes');
        }

        return {
            type: 'sentinel',
            options: {
                sentinels,
                name: process.env.REDIS_MASTER_NAME || 'mymaster',
                sentinelRetryDelayOnFailover: parseInt(process.env.REDIS_SENTINEL_RETRY_DELAY_ON_FAILOVER || '100', 10),
                sentinelRetryDelayOnClusterDown: parseInt(process.env.REDIS_SENTINEL_RETRY_DELAY_ON_CLUSTER_DOWN || '300', 10),
                connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
                commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10),
                family: parseInt(process.env.REDIS_FAMILY || '4', 10) as 4 | 6,
                keepAlive: process.env.REDIS_KEEP_ALIVE !== 'false',
                noDelay: process.env.REDIS_NO_DELAY !== 'false',
                connectionName: process.env.REDIS_CONNECTION_NAME || 'taskflow-sentinel',
                enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK !== 'false',
                maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '3', 10),
                lazyConnect: process.env.REDIS_LAZY_CONNECT !== 'false',
                maxLoadingTimeout: parseInt(process.env.REDIS_MAX_LOADING_TIMEOUT || '10000', 10),
                password: process.env.REDIS_PASSWORD,
                tls: process.env.REDIS_TLS === 'true' ? {
                    servername: process.env.REDIS_TLS_SERVERNAME,
                    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
                } : undefined,
            },
        };
    }

    // Single instance (default)
    return {
        type: 'single',
        options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB || '0', 10),
            connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
            commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10),
            family: parseInt(process.env.REDIS_FAMILY || '4', 10) as 4 | 6,
            keepAlive: process.env.REDIS_KEEP_ALIVE !== 'false',
            noDelay: process.env.REDIS_NO_DELAY !== 'false',
            connectionName: process.env.REDIS_CONNECTION_NAME || 'taskflow-single',
            enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK !== 'false',
            maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '3', 10),
            lazyConnect: process.env.REDIS_LAZY_CONNECT !== 'false',
            maxLoadingTimeout: parseInt(process.env.REDIS_MAX_LOADING_TIMEOUT || '10000', 10),
            tls: process.env.REDIS_TLS === 'true' ? {
                servername: process.env.REDIS_TLS_SERVERNAME,
                rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
            } : undefined,
        },
    };
});
