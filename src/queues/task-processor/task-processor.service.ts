import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { TasksService } from '../../modules/tasks/tasks.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';
import { ConcurrencyControlService } from '../../common/services/concurrency-control.service';
import { Task } from '../../modules/tasks/entities/task.entity';

export interface JobMetrics {
  processed: number;
  successful: number;
  failed: number;
  retries: number;
  avgProcessingTime: number;
}

interface BatchJobData {
  taskIds: string[];
  status: TaskStatus;
  batchId?: string;
  priority?: number;
}

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);
  private readonly metrics: JobMetrics = {
    processed: 0,
    successful: 0,
    failed: 0,
    retries: 0,
    avgProcessingTime: 0,
  };
  private readonly processingTimes: number[] = [];

  constructor(
    private readonly tasksService: TasksService,
    @InjectQueue('task-processing') private readonly taskQueue: Queue,
    private readonly concurrencyControl: ConcurrencyControlService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const startTime = Date.now();
    const jobId = job.id;
    const jobType = job.name;
    const attempt = job.attemptsMade + 1;

    this.logger.debug(`Processing job ${jobId} of type ${jobType} (attempt ${attempt})`);

    // Acquire concurrency slot
    const releaseSlot = await this.concurrencyControl.acquireSlot(jobType);

    try {
      // Update metrics
      this.metrics.processed++;
      if (attempt > 1) {
        this.metrics.retries++;
      }

      let result: any;
      console.log("jobType", jobType);
      switch (jobType) {
        case 'task-status-update':
          result = await this.handleStatusUpdate(job);
          break;
        case 'overdue-tasks-notification':
          result = await this.handleOverdueTasks(job);
          break;
        case 'batch-status-update':
          result = await this.handleBatchStatusUpdate(job);
          break;
        case 'bulk-task-processing':
          result = await this.handleBulkTaskProcessing(job);
          break;
        case 'dead-letter':
          result = await this.handleDeadLetterJob(job);
          break;
        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      // Update success metrics
      this.metrics.successful++;
      this.updateProcessingTime(startTime);

      this.logger.log(`Job ${jobId} completed successfully in ${Date.now() - startTime}ms`);
      return result;

    } catch (error) {
      this.logger.error(`Error processing job ${jobId} (attempt ${attempt}):`, error);

      // Update failure metrics
      this.metrics.failed++;
      this.updateProcessingTime(startTime);

      // Implement smart retry strategy
      if (this.shouldRetry(error, attempt, job)) {
        this.logger.warn(`Job ${jobId} will be retried (attempt ${attempt + 1})`);
        throw error; // Let BullMQ handle retry
      } else {
        // Send to dead letter queue
        await this.sendToDeadLetterQueue(job, error);
        this.logger.error(`Job ${jobId} failed permanently after ${attempt} attempts`);
        return {
          success: false,
          error: 'Permanent failure',
          shouldRetry: false,
          deadLetterQueue: true
        };
      }
    } finally {
      // Always release the concurrency slot
      releaseSlot();
    }
  }

  private shouldRetry(error: any, attemptsMade: number, job: Job): boolean {
    // Don't retry more than 5 times
    if (attemptsMade >= 5) return false;

    // Don't retry validation errors or business logic errors
    if (this.isPermanentError(error)) {
      return false;
    }

    // Don't retry if job has been in queue too long (24 hours)
    const jobAge = Date.now() - job.timestamp;
    if (jobAge > 24 * 60 * 60 * 1000) {
      return false;
    }

    // Retry transient errors (database, network, timeouts)
    return this.isTransientError(error);
  }

  private isPermanentError(error: any): boolean {
    const permanentErrorPatterns = [
      'validation',
      'not found',
      'unauthorized',
      'forbidden',
      'invalid',
      'malformed',
      'duplicate',
      'already exists'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    return permanentErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  private isTransientError(error: any): boolean {
    const transientErrorPatterns = [
      'timeout',
      'connection',
      'network',
      'database',
      'redis',
      'temporary',
      'busy',
      'locked',
      'rate limit'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    return transientErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  private async sendToDeadLetterQueue(job: Job, error: any): Promise<void> {
    try {
      await this.taskQueue.add('dead-letter', {
        originalJob: {
          id: job.id,
          name: job.name,
          data: job.data,
          timestamp: job.timestamp,
          attemptsMade: job.attemptsMade,
        },
        error: {
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        },
        reason: 'Max retries exceeded',
      }, {
        delay: 0,
        removeOnComplete: 100,
        removeOnFail: 50,
      });

      this.logger.log(`Job ${job.id} sent to dead letter queue`);
    } catch (dlqError) {
      this.logger.error(`Failed to send job ${job.id} to dead letter queue:`, dlqError);
    }
  }

  private updateProcessingTime(startTime: number): void {
    const processingTime = Date.now() - startTime;
    this.processingTimes.push(processingTime);

    // Keep only last 100 processing times for rolling average
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }

    // Update average processing time
    this.metrics.avgProcessingTime = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
  }

  // Public method to get metrics
  getMetrics(): JobMetrics {
    return { ...this.metrics };
  }

  // Method to reset metrics
  resetMetrics(): void {
    this.metrics.processed = 0;
    this.metrics.successful = 0;
    this.metrics.failed = 0;
    this.metrics.retries = 0;
    this.metrics.avgProcessingTime = 0;
    this.processingTimes.length = 0;
  }

  // Get concurrency status
  getConcurrencyStatus(): Record<string, any> {
    return this.concurrencyControl.getStatus();
  }

  // Update concurrency limits
  updateConcurrencyLimits(jobType: string, maxConcurrent: number): void {
    this.concurrencyControl.updateLimits(jobType, maxConcurrent);
  }

  private async handleDeadLetterJob(job: Job): Promise<any> {
    const { originalJob, error, reason } = job.data;

    this.logger.error(`Processing dead letter job ${originalJob.id}:`, {
      originalJobType: originalJob.name,
      reason,
      error: error.message,
      attemptsMade: originalJob.attemptsMade,
      timestamp: originalJob.timestamp,
    });

    // Here you could implement:
    // - Send alerts to administrators
    // - Store in a database for manual inspection
    // - Attempt to fix and reprocess
    // - Archive for analysis

    return {
      success: true,
      action: 'logged',
      originalJobId: originalJob.id,
      reason,
      timestamp: new Date().toISOString(),
    };
  }

  private async handleStatusUpdate(job: Job) {
    const { taskId, status } = job.data;

    if (!taskId || !status) {
      throw new Error('Missing required data: taskId and status are required');
    }

    // Validate status value
    if (!Object.values(TaskStatus).includes(status)) {
      throw new Error(`Invalid status value: ${status}`);
    }

    // Use the efficient update method from TasksService
    const task = await this.tasksService.update(taskId, { status });

    return {
      success: true,
      taskId: task.id,
      newStatus: task.status
    };
  }

  private async handleBatchStatusUpdate(job: Job) {
    const { taskIds, status } = job.data;

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      throw new Error('Missing required data: taskIds array is required');
    }

    if (!status || !Object.values(TaskStatus).includes(status)) {
      throw new Error(`Invalid status value: ${status}`);
    }

    // Process batch status update efficiently
    const results = [];

    try {
      // Process each task individually to ensure proper validation and error handling
      for (const taskId of taskIds) {
        try {
          const updatedTask = await this.tasksService.updateStatus(taskId, status);
          results.push({
            taskId,
            success: true,
            action: 'status_updated',
            newStatus: status,
            task: updatedTask
          });
        } catch (error) {
          this.logger.error(`Failed to update task ${taskId}:`, error);
          results.push({
            taskId,
            success: false,
            action: 'status_update',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      this.logger.log(`Batch status update completed: ${results.length} tasks updated to ${status}`);

      return {
        success: true,
        processed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
        updatedCount: results.filter(r => r.success).length
      };
    } catch (error) {
      this.logger.error('Error in batch status update:', error);

      // Return failed results for all tasks
      taskIds.forEach(taskId => {
        results.push({ taskId, success: false, action: 'status_update', error: error instanceof Error ? error.message : String(error) });
      });

      return {
        success: false,
        processed: results.length,
        successful: 0,
        failed: results.length,
        results,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async handleBulkTaskProcessing(job: Job) {
    const { batches, operation, options = {} } = job.data;

    if (!batches || !Array.isArray(batches) || batches.length === 0) {
      throw new Error('Missing required data: batches array is required');
    }

    if (!operation || !['update', 'delete', 'complete'].includes(operation)) {
      throw new Error(`Invalid operation: ${operation}`);
    }

    const { batchSize = 100, concurrency = 5 } = options;
    const results: Array<{ batchIndex: number; result: any }> = [];
    const errors: Array<{ batchIndex: number; error: string }> = [];

    this.logger.log(`Processing ${batches.length} batches with batch size ${batchSize} and concurrency ${concurrency}`);

    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchGroup = batches.slice(i, i + concurrency);

      const batchPromises = batchGroup.map(async (batch, index) => {
        try {
          const batchResult = await this.processBatch(batch, operation, batchSize);
          return { batchIndex: i + index, result: batchResult };
        } catch (error) {
          this.logger.error(`Batch ${i + index} failed:`, error);
          return { batchIndex: i + index, error: error instanceof Error ? error.message : String(error) };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if ('error' in result.value) {
            errors.push(result.value as { batchIndex: number; error: string });
          } else {
            results.push(result.value as { batchIndex: number; result: any });
          }
        } else {
          errors.push({ batchIndex: i + index, error: result.reason?.message || 'Unknown error' });
        }
      });
    }

    const totalProcessed = results.reduce((sum, r) => sum + ((r.result as any)?.processed || 0), 0);
    const totalSuccessful = results.reduce((sum, r) => sum + ((r.result as any)?.successful || 0), 0);
    const totalFailed = results.reduce((sum, r) => sum + ((r.result as any)?.failed || 0), 0);

    return {
      success: errors.length === 0,
      totalBatches: batches.length,
      processedBatches: results.length,
      failedBatches: errors.length,
      totalProcessed,
      totalSuccessful,
      totalFailed,
      results,
      errors
    };
  }

  private async processBatch(batch: BatchJobData, operation: string, batchSize: number): Promise<any> {
    const { taskIds, status, batchId } = batch;

    if (!taskIds || !Array.isArray(taskIds)) {
      throw new Error('Invalid batch: taskIds array is required');
    }

    // Split large batches into smaller chunks
    const chunks = [];
    for (let i = 0; i < taskIds.length; i += batchSize) {
      chunks.push(taskIds.slice(i, i + batchSize));
    }

    const chunkResults = [];
    for (const chunk of chunks) {
      try {
        let result;
        switch (operation) {
          case 'update':
            result = await this.tasksService.batchProcess(chunk, 'update');
            break;
          case 'delete':
            result = await this.tasksService.batchProcess(chunk, 'delete');
            break;
          case 'complete':
            result = await this.tasksService.batchProcess(chunk, 'complete');
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        chunkResults.push(result);
      } catch (error) {
        this.logger.error(`Chunk processing failed for batch ${batchId}:`, error);
        chunkResults.push({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          processed: chunk.length,
          successful: 0,
          failed: chunk.length
        });
      }
    }

    // Aggregate results
    const totalProcessed = chunkResults.reduce((sum, r) => sum + ((r as any).processed || 0), 0);
    const totalSuccessful = chunkResults.reduce((sum, r) => sum + ((r as any).successful || 0), 0);
    const totalFailed = chunkResults.reduce((sum, r) => sum + ((r as any).failed || 0), 0);

    return {
      batchId,
      operation,
      processed: totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      chunks: chunkResults.length,
      results: chunkResults
    };
  }


  private async handleOverdueTasks(job: Job) {
    this.logger.debug('Processing overdue tasks notification');

    const { tasks, timestamp } = job.data;

    if (!tasks || !Array.isArray(tasks)) {
      throw new Error('Invalid overdue tasks data: tasks array is required');
    }

    this.logger.log(`Processing ${tasks.length} overdue tasks`);

    // Extract task IDs for bulk processing
    const taskIds = tasks.map(task => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      this.logger.warn('No valid task IDs found in overdue tasks data');
      return { success: true, processed: 0, successful: 0, failed: 0, results: [] };
    }

    try {
      // Use bulk update for better performance
      const results = await this.tasksService.batchProcess(taskIds, 'complete');

      // Log overdue task details for monitoring
      tasks.forEach(taskData => {
        this.logger.warn(`Task overdue: ${taskData.title} (ID: ${taskData.id}) - Due: ${taskData.dueDate}`);
      });

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      this.logger.log(`Overdue tasks processing completed: ${successCount} successful, ${failureCount} failed`);

      return {
        success: true,
        processed: results.length,
        successful: successCount,
        failed: failureCount,
        results,
      };
    } catch (error) {
      this.logger.error('Error processing overdue tasks:', error);
      throw error; // Let the retry mechanism handle this
    }
  }
} 