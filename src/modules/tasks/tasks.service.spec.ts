import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { TasksService } from './tasks.service';
import { TaskRepository } from './repositories/task.repository';
import { Task } from './entities/task.entity';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { NotFoundException } from '@nestjs/common';
import { CacheService } from '../../common/services/cache.service';
import { TransactionManager } from '../../common/services/transaction-manager.service';

describe('TasksService', () => {
    let service: TasksService;
    let mockTaskRepository: any;
    let mockQueue: any;
    let mockCacheService: any;
    let transactionManager: any;

    const mockTask: Task = {
        id: '1',
        title: 'Test Task',
        description: 'Test Description',
        status: TaskStatus.PENDING,
        priority: TaskPriority.MEDIUM,
        dueDate: new Date(),
        userId: 'user-1',
        user: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        mockTaskRepository = {
            create: jest.fn(),
            findById: jest.fn(),
            findWithPagination: jest.fn(),
            findByStatus: jest.fn(),
            update: jest.fn(),
            updateStatus: jest.fn(),
            delete: jest.fn(),
            getStatistics: jest.fn(),
            batchUpdateStatus: jest.fn(),
            batchDelete: jest.fn(),
            getQueryRunner: jest.fn(),
        };

        mockQueue = {
            add: jest.fn(),
        };

        mockCacheService = {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            invalidatePattern: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TasksService,
                {
                    provide: TaskRepository,
                    useValue: mockTaskRepository,
                },
                {
                    provide: getQueueToken('task-processing'),
                    useValue: mockQueue,
                },
                {
                    provide: CacheService,
                    useValue: mockCacheService,
                },
                {
                    provide: TransactionManager,
                    useValue: {
                        executeInTransaction: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<TasksService>(TasksService);
        transactionManager = module.get<TransactionManager>(TransactionManager) as any;
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        it('should create a task successfully', async () => {
            const createTaskDto: CreateTaskDto = {
                title: 'Test Task',
                description: 'Test Description',
                userId: 'user-1',
                status: TaskStatus.PENDING,
                priority: TaskPriority.MEDIUM,
            };

            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                const result = await op(mockQueryRunner);
                await mockQueryRunner.commitTransaction();
                await mockQueryRunner.release();
                return result;
            });
            mockTaskRepository.create.mockResolvedValue(mockTask);
            mockCacheService.delete.mockResolvedValue(undefined);

            const result = await service.create(createTaskDto);

            expect(result).toEqual(mockTask);
            expect(mockTaskRepository.create).toHaveBeenCalledWith(createTaskDto, mockQueryRunner);
            expect(mockQueryRunner.connect).toHaveBeenCalled();
            expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.release).toHaveBeenCalled();
        });
    });

    describe('findAll', () => {
        it('should return paginated tasks', async () => {
            const filterDto = { page: 1, limit: 10 };
            const mockResult = {
                data: [mockTask],
                total: 1,
                page: 1,
                limit: 10,
            };

            mockCacheService.get.mockResolvedValue(null);
            mockTaskRepository.findWithPagination.mockResolvedValue(mockResult);
            mockCacheService.set.mockResolvedValue(undefined);

            const result = await service.findAll(filterDto);

            expect(result).toEqual(mockResult);
            expect(mockTaskRepository.findWithPagination).toHaveBeenCalledWith({
                page: 1,
                limit: 10,
                status: undefined,
                priority: undefined,
                userId: undefined,
            });
        });

        it('should filter tasks by status', async () => {
            const filterDto = { status: TaskStatus.PENDING };
            const mockResult = {
                data: [mockTask],
                total: 1,
                page: 1,
                limit: 10,
            };

            mockCacheService.get.mockResolvedValue(null);
            mockTaskRepository.findWithPagination.mockResolvedValue(mockResult);
            mockCacheService.set.mockResolvedValue(undefined);

            const result = await service.findAll(filterDto);

            expect(result).toEqual(mockResult);
            expect(mockTaskRepository.findWithPagination).toHaveBeenCalledWith({
                page: 1,
                limit: 10,
                status: TaskStatus.PENDING,
                priority: undefined,
                userId: undefined,
            });
        });
    });

    describe('findOne', () => {
        it('should return a task by id', async () => {
            mockCacheService.get.mockResolvedValue(null);
            mockTaskRepository.findById.mockResolvedValue(mockTask);
            mockCacheService.set.mockResolvedValue(undefined);

            const result = await service.findOne('1');

            expect(result).toEqual(mockTask);
            expect(mockTaskRepository.findById).toHaveBeenCalledWith('1');
        });

        it('should throw NotFoundException when task not found', async () => {
            mockCacheService.get.mockResolvedValue(null);
            mockTaskRepository.findById.mockResolvedValue(null);

            await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
            expect(mockTaskRepository.findById).toHaveBeenCalledWith('1');
        });
    });

    describe('update', () => {
        it('should update a task successfully', async () => {
            const updateTaskDto: UpdateTaskDto = {
                title: 'Updated Task',
                status: TaskStatus.IN_PROGRESS,
            };

            const updatedTask = { ...mockTask, ...updateTaskDto };
            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                try {
                    const result = await op(mockQueryRunner);
                    await mockQueryRunner.commitTransaction();
                    await mockQueryRunner.release();
                    return result;
                } catch (e) {
                    await mockQueryRunner.rollbackTransaction();
                    await mockQueryRunner.release();
                    throw e;
                }
            });
            mockTaskRepository.findById.mockResolvedValue(mockTask);
            mockTaskRepository.update.mockResolvedValue(updatedTask);
            mockCacheService.delete.mockResolvedValue(undefined);

            const result = await service.update('1', updateTaskDto);
            await new Promise((res) => setImmediate(res));

            expect(result).toEqual(updatedTask);
            expect(mockTaskRepository.findById).toHaveBeenCalledWith('1');
            expect(mockTaskRepository.update).toHaveBeenCalledWith('1', updateTaskDto, mockQueryRunner);
            expect(mockQueue.add).toHaveBeenCalledWith('task-status-update', {
                taskId: updatedTask.id,
                status: updatedTask.status,
                previousStatus: mockTask.status,
                timestamp: expect.any(String),
            }, {
                delay: 0,
                removeOnComplete: 50,
                removeOnFail: 25,
                attempts: 3,
            });
        });

        it('should throw NotFoundException when task not found', async () => {
            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                try {
                    const result = await op(mockQueryRunner);
                    await mockQueryRunner.commitTransaction();
                    await mockQueryRunner.release();
                    return result;
                } catch (e) {
                    await mockQueryRunner.rollbackTransaction();
                    await mockQueryRunner.release();
                    throw e;
                }
            });
            mockTaskRepository.findById.mockResolvedValue(null);

            await expect(service.update('1', { title: 'Updated' })).rejects.toThrow(NotFoundException);
            expect(mockTaskRepository.findById).toHaveBeenCalledWith('1');
        });
    });

    describe('remove', () => {
        it('should remove a task successfully', async () => {
            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                const result = await op(mockQueryRunner);
                await mockQueryRunner.commitTransaction();
                await mockQueryRunner.release();
                return result;
            });
            mockTaskRepository.delete.mockResolvedValue(undefined);
            mockCacheService.delete.mockResolvedValue(undefined);

            await service.remove('1');

            expect(mockTaskRepository.delete).toHaveBeenCalledWith('1', mockQueryRunner);
            expect(mockQueryRunner.connect).toHaveBeenCalled();
            expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.release).toHaveBeenCalled();
        });

        it('should throw NotFoundException when task not found', async () => {
            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                try {
                    const result = await op(mockQueryRunner);
                    await mockQueryRunner.commitTransaction();
                    await mockQueryRunner.release();
                    return result;
                } catch (e) {
                    await mockQueryRunner.rollbackTransaction();
                    await mockQueryRunner.release();
                    throw e;
                }
            });
            mockTaskRepository.delete.mockRejectedValue(new Error('Task not found'));

            await expect(service.remove('1')).rejects.toThrow('Task not found');
            expect(mockTaskRepository.delete).toHaveBeenCalledWith('1', mockQueryRunner);
        });
    });

    describe('getTaskStatistics', () => {
        it('should return task statistics', async () => {
            const mockStats = {
                total: 10,
                completed: 5,
                inProgress: 3,
                pending: 2,
                highPriority: 1,
            };

            mockCacheService.get.mockResolvedValue(null);
            mockTaskRepository.getStatistics.mockResolvedValue(mockStats);
            mockCacheService.set.mockResolvedValue(undefined);

            const result = await service.getTaskStatistics();

            expect(result).toEqual(mockStats);
            expect(mockTaskRepository.getStatistics).toHaveBeenCalled();
        });
    });

    describe('batchProcess', () => {
        it('should complete multiple tasks', async () => {
            const taskIds = ['1', '2', '3'];
            const action = 'complete';

            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                const result = await op(mockQueryRunner);
                await mockQueryRunner.commitTransaction();
                await mockQueryRunner.release();
                return result;
            });
            mockTaskRepository.batchUpdateStatus.mockResolvedValue(undefined);
            mockQueue.add.mockResolvedValue({});
            mockCacheService.delete.mockResolvedValue(undefined);

            const result = await service.batchProcess(taskIds, action);
            await new Promise((res) => setImmediate(res));

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({ taskId: '1', success: true, action: 'completed' });
            expect(mockTaskRepository.batchUpdateStatus).toHaveBeenCalledWith(taskIds, TaskStatus.COMPLETED, mockQueryRunner);
            expect(mockQueue.add).toHaveBeenCalledWith('batch-status-update', expect.objectContaining({
                taskIds,
                status: TaskStatus.COMPLETED,
            }), expect.any(Object));
        });

        it('should delete multiple tasks', async () => {
            const taskIds = ['1', '2', '3'];
            const action = 'delete';

            const mockQueryRunner = {
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
            };

            (transactionManager.executeInTransaction as jest.Mock).mockImplementation(async (op: any) => {
                await mockQueryRunner.connect();
                await mockQueryRunner.startTransaction();
                const result = await op(mockQueryRunner);
                await mockQueryRunner.commitTransaction();
                await mockQueryRunner.release();
                return result;
            });
            mockTaskRepository.batchDelete.mockResolvedValue(undefined);
            mockCacheService.delete.mockResolvedValue(undefined);

            const result = await service.batchProcess(taskIds, action);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({ taskId: '1', success: true, action: 'deleted' });
            expect(mockTaskRepository.batchDelete).toHaveBeenCalledWith(taskIds, mockQueryRunner);
        });
    });
});
