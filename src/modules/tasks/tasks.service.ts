import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/pagination.dto';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { TaskRepository, TaskPaginationOptions, TaskPaginationResult, TaskStatistics } from './repositories/task.repository';
import { CacheService } from '../../common/services/cache.service';
import { TransactionManager } from '../../common/services/transaction-manager.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly taskRepository: TaskRepository,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    private cacheService: CacheService,
    private transactionManager: TransactionManager,
  ) { }

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    return this.transactionManager.executeInTransaction(async (queryRunner) => {
      const savedTask = await this.taskRepository.create(createTaskDto, queryRunner);

      // Invalidate relevant caches after successful transaction
      await this.invalidateTaskCaches();

      return savedTask;
    });
  }

  async findAll(filterDto: TaskFilterDto = {}): Promise<TaskPaginationResult> {
    const { page = 1, limit = 10, status, priority, userId, sortBy, sortOrder } = filterDto;

    // Create cache key based on filters including sorting
    const cacheKey = `tasks:list:${JSON.stringify({ page, limit, status, priority, userId, sortBy, sortOrder })}`;

    // Try to get from cache first
    const cachedResult = await this.cacheService.get<TaskPaginationResult>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Use repository for pagination with enhanced options
    const paginationOptions: TaskPaginationOptions = {
      page,
      limit,
      status: status as TaskStatus,
      priority: priority as TaskPriority,
      userId,
      sortBy,
      sortOrder,
    };

    const result = await this.taskRepository.findWithPagination(paginationOptions);

    // Cache the result for 5 minutes
    await this.cacheService.set(cacheKey, result, 300);

    return result;
  }

  async findOne(id: string): Promise<Task> {
    const cacheKey = `task:${id}`;

    // Try to get from cache first
    const cachedTask = await this.cacheService.get<Task>(cacheKey);
    if (cachedTask) {
      return cachedTask;
    }

    const task = await this.taskRepository.findById(id);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    // Cache the task for 10 minutes
    await this.cacheService.set(cacheKey, task, 600);

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    return this.transactionManager.executeInTransaction(async (queryRunner) => {
      const task = await this.taskRepository.findById(id);

      if (!task) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      const originalStatus = task.status;

      // Update fields
      const updatedTask = await this.taskRepository.update(id, updateTaskDto, queryRunner);

      // Add to queue if status changed (outside transaction to avoid blocking)
      if (originalStatus !== updatedTask.status) {
        console.log("adding to queue");
        // Queue the update asynchronously after transaction commits
        setImmediate(async () => {
          try {
            await this.taskQueue.add('task-status-update', {
              taskId: updatedTask.id,
              status: updatedTask.status,
              previousStatus: originalStatus,
              timestamp: new Date().toISOString(),
            }, {
              delay: 0,
              removeOnComplete: 50,
              removeOnFail: 25,
              attempts: 3,
            });
          } catch (error) {
            console.error('Failed to add task status update to queue:', error);
          }
        });
      }

      // Invalidate caches after successful update
      await this.invalidateTaskCache(updatedTask.id);

      return updatedTask;
    });
  }

  async remove(id: string): Promise<void> {
    return this.transactionManager.executeInTransaction(async (queryRunner) => {
      await this.taskRepository.delete(id, queryRunner);

      // Invalidate caches after successful deletion
      await this.invalidateTaskCache(id);
    });
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.taskRepository.findByStatus(status);
  }

  async updateStatus(id: string, status: string): Promise<Task> {
    const newStatus = status as TaskStatus;

    // Use single-query update with RETURNING clause
    const result = await this.taskRepository.updateStatusWithReturning(id, newStatus);

    if (!result) {
      throw new NotFoundException(`Task with ID ${id} not found or status unchanged`);
    }

    const { task: updatedTask, previousStatus } = result;

    // Queue the status update for processing
    try {
      await this.taskQueue.add('task-status-update', {
        taskId: id,
        status: newStatus,
        previousStatus,
        timestamp: new Date().toISOString(),
      }, {
        delay: 0,
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 3,
      });
    } catch (error) {
      console.error('Failed to add task status update to queue:', error);
      // Don't fail the operation, but log the error
    }

    // Invalidate cache for this specific task
    await this.invalidateTaskCache(id);

    return updatedTask;
  }

  async getTaskStatistics(): Promise<TaskStatistics> {
    const cacheKey = 'tasks:stats';

    // Try to get from cache first
    const cachedStats = await this.cacheService.get<TaskStatistics>(cacheKey);

    if (cachedStats) {
      return cachedStats;
    }

    // Use repository for statistics
    const stats = await this.taskRepository.getStatistics();

    // Cache the statistics for 2 minutes
    await this.cacheService.set(cacheKey, stats, 120);

    return stats;
  }

  async getPaginationInfo(filterDto: TaskFilterDto = {}): Promise<{
    total: number;
    totalPages: number;
    page: number;
    limit: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextPage?: number;
    previousPage?: number;
  }> {
    const { page = 1, limit = 10, status, priority, userId } = filterDto;

    // Create cache key for pagination info
    const cacheKey = `tasks:pagination:${JSON.stringify({ page, limit, status, priority, userId })}`;

    // Try to get from cache first
    const cachedResult = await this.cacheService.get<{
      total: number;
      totalPages: number;
      page: number;
      limit: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      nextPage?: number;
      previousPage?: number;
    }>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Use repository for pagination info
    const paginationOptions: TaskPaginationOptions = {
      page,
      limit,
      status: status as TaskStatus,
      priority: priority as TaskPriority,
      userId,
    };

    const result = await this.taskRepository.getPaginationInfo(paginationOptions);

    // Cache the result for 3 minutes (shorter than data cache since it's metadata)
    await this.cacheService.set(cacheKey, result, 180);

    return result;
  }

  async batchProcess(taskIds: string[], action: string, status?: TaskStatus): Promise<any[]> {
    if (taskIds.length === 0) return [];

    return this.transactionManager.executeInTransaction(async (queryRunner) => {
      const results = [];

      if (action === 'complete') {
        // Bulk update using repository
        await this.taskRepository.batchUpdateStatus(taskIds, TaskStatus.COMPLETED, queryRunner);

        // Add individual results for tracking
        taskIds.forEach(taskId => {
          results.push({ taskId, success: true, action: 'completed' });
        });

        // Queue batch notification asynchronously
        setImmediate(async () => {
          try {
            await this.taskQueue.add('batch-status-update', {
              taskIds,
              status: TaskStatus.COMPLETED,
              batchId: `complete-${Date.now()}`,
              timestamp: new Date().toISOString(),
            }, {
              delay: 0,
              removeOnComplete: 20,
              removeOnFail: 10,
              attempts: 3,
              priority: 1,
            });
          } catch (error) {
            console.error(`Failed to queue batch task update:`, error);
          }
        });

        // Invalidate caches after successful batch operation
        await this.invalidateTaskCaches();
      } else if (action === 'delete') {
        // Bulk delete using repository
        await this.taskRepository.batchDelete(taskIds, queryRunner);

        for (const taskId of taskIds) {
          results.push({ taskId, success: true, action: 'deleted' });
        }

        // Invalidate caches after successful deletion
        await this.invalidateTaskCaches();
      } else if (action === 'update' && status) {
        // Bulk update using repository
        await this.taskRepository.batchUpdateStatus(taskIds, status, queryRunner);

        // Add individual results for tracking
        taskIds.forEach(taskId => {
          results.push({ taskId, success: true, action: 'status_updated', newStatus: status });
        });

        // Queue batch notification asynchronously
        setImmediate(async () => {
          try {
            await this.taskQueue.add('batch-status-update', {
              taskIds,
              status,
              batchId: `update-${status}-${Date.now()}`,
              timestamp: new Date().toISOString(),
            }, {
              delay: 0,
              removeOnComplete: 20,
              removeOnFail: 10,
              attempts: 3,
              priority: 1,
            });
          } catch (error) {
            console.error(`Failed to queue batch status update:`, error);
          }
        });

        // Invalidate caches after successful batch operation
        await this.invalidateTaskCaches();
      } else if (action === 'update') {
        // This is a generic update action without specific status
        for (const taskId of taskIds) {
          results.push({ taskId, success: true, action: 'update_pending' });
        }
      }

      return results;
    });
  }

  private async invalidateTaskCaches(): Promise<void> {
    try {
      // Use pattern-based invalidation
      await this.cacheService.invalidatePattern('tasks:list:*');
      await this.cacheService.delete('tasks:stats');
    } catch (error) {
      console.error('Failed to invalidate task caches:', error);
    }
  }

  private async invalidateTaskCache(taskId: string): Promise<void> {
    try {
      await this.cacheService.delete(`task:${taskId}`);
      // Only invalidate list caches, not all caches
      await this.cacheService.invalidatePattern('tasks:list:*');
    } catch (error) {
      console.error(`Failed to invalidate cache for task ${taskId}:`, error);
    }
  }
}
