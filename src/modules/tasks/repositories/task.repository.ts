/* istanbul ignore file */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, FindOptionsWhere, DataSource, QueryRunner } from 'typeorm';
import { Task } from '../entities/task.entity';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

export interface TaskStatistics {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    highPriority: number;
}

export interface TaskPaginationOptions {
    page?: number;
    limit?: number;
    status?: TaskStatus;
    priority?: TaskPriority;
    userId?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
}

export interface TaskPaginationResult {
    data: Task[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextPage?: number;
    previousPage?: number;
}

@Injectable()
export class TaskRepository {
    constructor(
        @InjectRepository(Task)
        private readonly repository: Repository<Task>,
        private readonly dataSource: DataSource,
    ) { }

    /**
     * Create a new task
     */
    async create(createTaskDto: any, queryRunner?: QueryRunner): Promise<Task> {
        const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;
        const task = manager.create(Task, createTaskDto);
        return manager.save(Task, task);
    }

    /**
     * Find a task by ID with relations
     */
    async findById(id: string, relations: string[] = ['user']): Promise<Task | null> {
        return this.repository.findOne({
            where: { id },
            relations,
        });
    }

    /**
     * Find tasks with pagination and filtering
     */
    async findWithPagination(options: TaskPaginationOptions): Promise<TaskPaginationResult> {
        const {
            page = 1,
            limit = 10,
            status,
            priority,
            userId,
            sortBy = 'createdAt',
            sortOrder = 'DESC'
        } = options;

        // Validate and sanitize pagination parameters
        const validatedPage = Math.max(1, Math.floor(page));
        const validatedLimit = Math.min(Math.max(1, Math.floor(limit)), 100);
        const skip = (validatedPage - 1) * validatedLimit;

        // Build where conditions
        const where: FindOptionsWhere<Task> = {};
        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (userId) where.userId = userId;

        // Validate sortBy field to prevent SQL injection
        const allowedSortFields = ['createdAt', 'updatedAt', 'title', 'dueDate', 'priority', 'status'];
        const validatedSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
        const validatedSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

        const [tasks, total] = await this.repository.findAndCount({
            where,
            relations: ['user'],
            skip,
            take: validatedLimit,
            order: { [validatedSortBy]: validatedSortOrder },
        });

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / validatedLimit);
        const hasNextPage = validatedPage < totalPages;
        const hasPreviousPage = validatedPage > 1;

        return {
            data: tasks,
            total,
            page: validatedPage,
            limit: validatedLimit,
            totalPages,
            hasNextPage,
            hasPreviousPage,
            nextPage: hasNextPage ? validatedPage + 1 : undefined,
            previousPage: hasPreviousPage ? validatedPage - 1 : undefined,
        };
    }

    /**
     * Find tasks by status
     */
    async findByStatus(status: TaskStatus): Promise<Task[]> {
        return this.repository.find({
            where: { status },
            relations: ['user'],
        });
    }

    /**
     * Update a task
     */
    async update(id: string, updateData: Partial<Task>, queryRunner?: QueryRunner): Promise<Task> {
        const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;

        const existing = await manager.findOne(Task, {
            where: { id },
            relations: ['user'],
        });

        if (!existing) {
            throw new Error(`Task with ID ${id} not found`);
        }

        // Use optimistic locking by checking version
        const nextVersion = (existing.version || 1) + 1;

        const result = await manager.createQueryBuilder()
            .update(Task)
            .set({ ...updateData, version: nextVersion })
            .where('id = :id', { id })
            .andWhere('version = :version', { version: existing.version || 1 })
            .returning('*')
            .execute();

        if (result.affected === 0) {
            throw new Error('Task update conflict detected (optimistic lock)');
        }

        return result.raw[0] as Task;
    }

    /**
     * Update task status efficiently
     */
    async updateStatus(id: string, status: TaskStatus): Promise<void> {
        await this.repository.update(id, { status });
    }

    /**
     * Update task status with RETURNING clause for single-query operation
     */
    async updateStatusWithReturning(id: string, status: TaskStatus): Promise<{ task: Task; previousStatus: TaskStatus } | null> {
        // First, get the current task to capture the previous status
        const currentTask = await this.repository.findOne({
            where: { id },
            select: ['id', 'status']
        });

        if (!currentTask) {
            return null;
        }

        const previousStatus = currentTask.status;

        // Update the task status
        // Optimistic lock on status change: ensure version matches current
        const result = await this.repository
            .createQueryBuilder()
            .update(Task)
            .set({ status, version: () => 'version + 1' })
            .where('id = :id', { id })
            .andWhere('status != :newStatus', { newStatus: status })
            .andWhere('version = :version', { version: currentTask['version'] || 1 })
            .returning('*')
            .execute();

        if (result.affected === 0) {
            return null;
        }

        const updatedTask = result.raw[0];

        return {
            task: updatedTask,
            previousStatus
        };
    }

    /**
     * Delete a task
     */
    async delete(id: string, queryRunner?: QueryRunner): Promise<void> {
        const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;

        const task = await manager.findOne(Task, { where: { id } });
        if (!task) {
            throw new Error(`Task with ID ${id} not found`);
        }

        await manager.remove(Task, task);
    }

    /**
     * Get task statistics
     */
    async getStatistics(): Promise<TaskStatistics> {
        const [total, completed, inProgress, pending, highPriority] = await Promise.all([
            this.repository.count(),
            this.repository.count({ where: { status: TaskStatus.COMPLETED } }),
            this.repository.count({ where: { status: TaskStatus.IN_PROGRESS } }),
            this.repository.count({ where: { status: TaskStatus.PENDING } }),
            this.repository.count({ where: { priority: TaskPriority.HIGH } }),
        ]);

        return {
            total,
            completed,
            inProgress,
            pending,
            highPriority,
        };
    }

    /**
     * Batch update task statuses
     */
    async batchUpdateStatus(taskIds: string[], status: TaskStatus, queryRunner?: QueryRunner): Promise<void> {
        const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;

        await manager
            .createQueryBuilder()
            .update(Task)
            .set({ status })
            .where('id IN (:...ids)', { ids: taskIds })
            .execute();
    }

    /**
     * Batch delete tasks
     */
    async batchDelete(taskIds: string[], queryRunner?: QueryRunner): Promise<void> {
        const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;

        await manager
            .createQueryBuilder()
            .delete()
            .from(Task)
            .where('id IN (:...ids)', { ids: taskIds })
            .execute();
    }

    /**
     * Find tasks by user ID
     */
    async findByUserId(userId: string, options?: FindManyOptions<Task>): Promise<Task[]> {
        return this.repository.find({
            where: { userId },
            relations: ['user'],
            ...options,
        });
    }

    /**
     * Find overdue tasks
     */
    async findOverdueTasks(): Promise<Task[]> {
        return this.repository
            .createQueryBuilder('task')
            .where('task.dueDate < :now', { now: new Date() })
            .andWhere('task.status != :completed', { completed: TaskStatus.COMPLETED })
            .leftJoinAndSelect('task.user', 'user')
            .getMany();
    }

    /**
     * Count tasks by status
     */
    async countByStatus(status: TaskStatus): Promise<number> {
        return this.repository.count({ where: { status } });
    }

    /**
     * Count tasks by user
     */
    async countByUser(userId: string): Promise<number> {
        return this.repository.count({ where: { userId } });
    }

    /**
     * Find tasks with complex filtering
     */
    async findWithComplexFilter(options: {
        status?: TaskStatus;
        priority?: TaskPriority;
        userId?: string;
        dueDateFrom?: Date;
        dueDateTo?: Date;
        searchTerm?: string;
    }): Promise<Task[]> {
        const queryBuilder = this.repository
            .createQueryBuilder('task')
            .leftJoinAndSelect('task.user', 'user');

        if (options.status) {
            queryBuilder.andWhere('task.status = :status', { status: options.status });
        }

        if (options.priority) {
            queryBuilder.andWhere('task.priority = :priority', { priority: options.priority });
        }

        if (options.userId) {
            queryBuilder.andWhere('task.userId = :userId', { userId: options.userId });
        }

        if (options.dueDateFrom) {
            queryBuilder.andWhere('task.dueDate >= :dueDateFrom', { dueDateFrom: options.dueDateFrom });
        }

        if (options.dueDateTo) {
            queryBuilder.andWhere('task.dueDate <= :dueDateTo', { dueDateTo: options.dueDateTo });
        }

        if (options.searchTerm) {
            queryBuilder.andWhere(
                '(task.title ILIKE :searchTerm OR task.description ILIKE :searchTerm)',
                { searchTerm: `%${options.searchTerm}%` }
            );
        }

        return queryBuilder
            .orderBy('task.createdAt', 'DESC')
            .getMany();
    }

    /**
     * Get pagination metadata without fetching data
     */
    async getPaginationInfo(options: TaskPaginationOptions): Promise<{
        total: number;
        totalPages: number;
        page: number;
        limit: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        nextPage?: number;
        previousPage?: number;
    }> {
        const {
            page = 1,
            limit = 10,
            status,
            priority,
            userId
        } = options;

        // Validate and sanitize pagination parameters
        const validatedPage = Math.max(1, Math.floor(page));
        const validatedLimit = Math.min(Math.max(1, Math.floor(limit)), 100);

        // Build where conditions
        const where: FindOptionsWhere<Task> = {};
        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (userId) where.userId = userId;

        // Get total count
        const total = await this.repository.count({ where });

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / validatedLimit);
        const hasNextPage = validatedPage < totalPages;
        const hasPreviousPage = validatedPage > 1;

        return {
            total,
            totalPages,
            page: validatedPage,
            limit: validatedLimit,
            hasNextPage,
            hasPreviousPage,
            nextPage: hasNextPage ? validatedPage + 1 : undefined,
            previousPage: hasPreviousPage ? validatedPage - 1 : undefined,
        };
    }

    /**
     * Get query runner for transactions
     */
    getQueryRunner(): QueryRunner {
        return this.dataSource.createQueryRunner();
    }
}
