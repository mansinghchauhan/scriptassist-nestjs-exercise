import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { RedisConnectionService } from '../services/redis-connection.service';
import { PerformanceMonitorService } from '../services/performance-monitor.service';

@Injectable()
export class HealthService {
    private readonly logger = new Logger(HealthService.name);

    constructor(
        @InjectDataSource()
        private readonly dataSource: DataSource,
        @InjectRedis()
        private readonly redis: Redis,
        private readonly redisConnectionService: RedisConnectionService,
        private readonly performanceMonitor: PerformanceMonitorService,
    ) { }

    async getHealth() {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0',
        };
    }

    async getDetailedHealth() {
        const health = await this.getHealth();
        const checks = await this.performHealthChecks();

        return {
            ...health,
            checks,
            overall: checks.every(check => check.status === 'healthy') ? 'healthy' : 'unhealthy',
        };
    }

    async getLiveness() {
        return { status: 'alive', timestamp: new Date().toISOString() };
    }

    async getReadiness() {
        // Basic readiness: DB and Redis healthy
        const checks = await this.performHealthChecks();
        const ready = checks.every(c => c.status === 'healthy' || c.name === 'memory' || c.name === 'disk');
        return { status: ready ? 'ready' : 'not-ready', checks };
    }

    async getMetrics() {
        const stats = this.performanceMonitor.getStats();
        const recent = this.performanceMonitor.getRecentMetrics(100);
        return {
            process: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                pid: process.pid,
                version: process.env.npm_package_version || '1.0.0',
            },
            performance: stats,
            recent,
        };
    }

    async selfHeal() {
        const before = this.redisConnectionService.getHealthStatus();
        this.redisConnectionService.resetCircuitBreaker();
        // Attempt a ping to warm the connection path
        try { await this.redis.ping(); } catch { }
        const after = this.redisConnectionService.getHealthStatus();
        return { message: 'Self-heal triggered', before, after };
    }

    private async performHealthChecks() {
        const checks = [];

        // Database health check
        try {
            await this.dataSource.query('SELECT 1');
            checks.push({
                name: 'database',
                status: 'healthy',
                message: 'Database connection is working',
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            this.logger.error('Database health check failed:', error);
            checks.push({
                name: 'database',
                status: 'unhealthy',
                message: 'Database connection failed',
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString(),
            });
        }

        // Redis health check using distributed connection service
        try {
            const redisHealth = this.redisConnectionService.getHealthStatus();
            if (redisHealth.isConnected) {
                checks.push({
                    name: 'redis',
                    status: 'healthy',
                    message: `Redis connection is working (latency: ${redisHealth.latency}ms, nodes: ${redisHealth.nodeCount})`,
                    details: {
                        latency: redisHealth.latency,
                        nodeCount: redisHealth.nodeCount,
                        clusterState: redisHealth.clusterState,
                        circuitBreakerOpen: this.redisConnectionService.isCircuitBreakerOpen(),
                    },
                    timestamp: new Date().toISOString(),
                });
            } else {
                throw new Error('Redis connection service reports unhealthy status');
            }
        } catch (error) {
            this.logger.error('Redis health check failed:', error);
            checks.push({
                name: 'redis',
                status: 'unhealthy',
                message: 'Redis connection failed',
                error: error instanceof Error ? error.message : String(error),
                details: {
                    circuitBreakerOpen: this.redisConnectionService.isCircuitBreakerOpen(),
                    healthStatus: this.redisConnectionService.getHealthStatus(),
                },
                timestamp: new Date().toISOString(),
            });
        }

        // Memory usage check
        const memoryUsage = process.memoryUsage();
        const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
        const memoryThreshold = 500; // 500MB threshold

        checks.push({
            name: 'memory',
            status: memoryUsageMB < memoryThreshold ? 'healthy' : 'warning',
            message: `Memory usage: ${memoryUsageMB.toFixed(2)}MB`,
            details: {
                heapUsed: memoryUsage.heapUsed,
                heapTotal: memoryUsage.heapTotal,
                external: memoryUsage.external,
                rss: memoryUsage.rss,
            },
            timestamp: new Date().toISOString(),
        });

        // Disk space check (simplified)
        try {
            const fs = require('fs');
            const stats = fs.statSync('.');
            checks.push({
                name: 'disk',
                status: 'healthy',
                message: 'Disk access is working',
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            checks.push({
                name: 'disk',
                status: 'unhealthy',
                message: 'Disk access failed',
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString(),
            });
        }

        return checks;
    }
}
