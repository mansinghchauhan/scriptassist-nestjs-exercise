import { Injectable, Logger } from '@nestjs/common';

export interface PerformanceMetrics {
    operation: string;
    duration: number;
    timestamp: number;
    success: boolean;
    error?: string;
}

@Injectable()
export class PerformanceMonitorService {
    private readonly logger = new Logger(PerformanceMonitorService.name);
    private readonly metrics: PerformanceMetrics[] = [];
    private readonly maxMetrics = 1000; // Keep last 1000 metrics

    /**
     * Track the performance of an operation
     */
    async trackOperation<T>(
        operationName: string,
        operation: () => Promise<T>
    ): Promise<T> {
        const startTime = Date.now();
        let success = true;
        let error: string | undefined;

        try {
            const result = await operation();
            return result;
        } catch (err) {
            success = false;
            error = err instanceof Error ? err.message : String(err);
            throw err;
        } finally {
            const duration = Date.now() - startTime;
            this.recordMetric({
                operation: operationName,
                duration,
                timestamp: Date.now(),
                success,
                error,
            });

            if (duration > 1000) { // Log slow operations (>1s)
                this.logger.warn(`Slow operation detected: ${operationName} took ${duration}ms`);
            }
        }
    }

    /**
     * Record a metric from external callers (e.g., interceptors)
     */
    recordOperationMetric(operation: string, duration: number, success: boolean, error?: string): void {
        this.recordMetric({
            operation,
            duration,
            timestamp: Date.now(),
            success,
            error,
        });
        if (duration > 1000) {
            this.logger.warn(`Slow operation detected: ${operation} took ${duration}ms`);
        }
    }

    /**
     * Get performance statistics
     */
    getStats(): {
        totalOperations: number;
        averageDuration: number;
        slowOperations: number;
        errorRate: number;
        operationsByType: Record<string, { count: number; avgDuration: number }>;
    } {
        const totalOperations = this.metrics.length;
        const averageDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0) / totalOperations || 0;
        const slowOperations = this.metrics.filter(m => m.duration > 1000).length;
        const errorRate = this.metrics.filter(m => !m.success).length / totalOperations || 0;

        // Group by operation type
        const operationsByType: Record<string, { count: number; avgDuration: number }> = {};
        this.metrics.forEach(metric => {
            if (!operationsByType[metric.operation]) {
                operationsByType[metric.operation] = { count: 0, avgDuration: 0 };
            }
            operationsByType[metric.operation].count++;
        });

        // Calculate average duration per operation type
        Object.keys(operationsByType).forEach(operation => {
            const operationMetrics = this.metrics.filter(m => m.operation === operation);
            operationsByType[operation].avgDuration =
                operationMetrics.reduce((sum, m) => sum + m.duration, 0) / operationMetrics.length;
        });

        return {
            totalOperations,
            averageDuration: Math.round(averageDuration),
            slowOperations,
            errorRate: Math.round(errorRate * 100) / 100,
            operationsByType,
        };
    }

    /**
     * Get recent metrics
     */
    getRecentMetrics(limit = 50): PerformanceMetrics[] {
        return this.metrics.slice(-limit);
    }

    /**
     * Clear all metrics
     */
    clearMetrics(): void {
        this.metrics.length = 0;
        this.logger.log('Performance metrics cleared');
    }

    private recordMetric(metric: PerformanceMetrics): void {
        this.metrics.push(metric);

        // Keep only the last maxMetrics entries
        if (this.metrics.length > this.maxMetrics) {
            this.metrics.shift();
        }
    }
}
