/* istanbul ignore file */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

@Injectable()
export class TransactionManager {
    private readonly logger = new Logger(TransactionManager.name);

    constructor(private readonly dataSource: DataSource) { }

    /**
     * Execute an operation within a database transaction
     * Automatically handles connection management, transaction lifecycle, and cleanup
     */
    async executeInTransaction<T>(
        operation: (queryRunner: QueryRunner) => Promise<T>
    ): Promise<T> {
        const queryRunner = this.dataSource.createQueryRunner();

        try {
            await queryRunner.connect();
            await queryRunner.startTransaction();

            this.logger.debug('Transaction started');

            const result = await operation(queryRunner);

            await queryRunner.commitTransaction();
            this.logger.debug('Transaction committed successfully');

            return result;
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Transaction rolled back due to error:', error);
            throw error;
        } finally {
            await queryRunner.release();
            this.logger.debug('QueryRunner released');
        }
    }

    /**
     * Execute multiple operations in a single transaction
     */
    async executeBatchInTransaction<T>(
        operations: Array<(queryRunner: QueryRunner) => Promise<T>>
    ): Promise<T[]> {
        return this.executeInTransaction(async (queryRunner) => {
            const results: T[] = [];

            for (const operation of operations) {
                const result = await operation(queryRunner);
                results.push(result);
            }

            return results;
        });
    }

    /**
     * Execute an operation with retry logic for transient errors
     */
    async executeWithRetry<T>(
        operation: (queryRunner: QueryRunner) => Promise<T>,
        maxRetries: number = 3,
        delayMs: number = 1000
    ): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.executeInTransaction(operation);
            } catch (error) {
                lastError = error as Error;

                if (this.isTransientError(error) && attempt < maxRetries) {
                    this.logger.warn(`Transaction attempt ${attempt} failed, retrying in ${delayMs}ms:`, error);
                    await this.delay(delayMs * attempt); // Exponential backoff
                } else {
                    break;
                }
            }
        }

        throw lastError!;
    }

    private isTransientError(error: any): boolean {
        const transientPatterns = [
            'timeout',
            'connection',
            'network',
            'database',
            'temporary',
            'busy',
            'locked',
            'deadlock'
        ];

        const errorMessage = error.message?.toLowerCase() || '';
        return transientPatterns.some(pattern => errorMessage.includes(pattern));
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
