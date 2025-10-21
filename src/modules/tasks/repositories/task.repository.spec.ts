import { DataSource, QueryRunner, Repository } from 'typeorm';
import { TaskRepository } from './task.repository';
import { Task } from '../entities/task.entity';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

describe('TaskRepository', () => {
    let repository: TaskRepository;
    let ormRepository: jest.Mocked<Repository<Task>>;
    let dataSource: any;

    const sampleTask: Task = {
        id: 't1',
        title: 'Title',
        description: 'Desc',
        status: TaskStatus.PENDING,
        priority: TaskPriority.MEDIUM,
        dueDate: new Date(),
        userId: 'u1',
        user: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        ormRepository = {
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn() as any,
        } as any;

        const manager = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
        };

        dataSource = {
            manager,
            createQueryRunner: jest.fn().mockReturnValue({} as QueryRunner),
        } as any;

        repository = new TaskRepository(ormRepository as any, dataSource as any);
    });

    it('create: should create and save via manager', async () => {
        (dataSource.manager.create as jest.Mock).mockReturnValue(sampleTask);
        (dataSource.manager.save as jest.Mock).mockResolvedValue(sampleTask);

        const result = await repository.create({ title: 'Title' }, undefined);
        expect(dataSource.manager.create).toHaveBeenCalled();
        expect(dataSource.manager.save).toHaveBeenCalled();
        expect(result).toEqual(sampleTask);
    });

    it('findById: should fetch with relations', async () => {
        ormRepository.findOne.mockResolvedValue(sampleTask);
        const result = await repository.findById('t1');
        expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: 't1' }, relations: ['user'] });
        expect(result).toEqual(sampleTask);
    });

    it('findWithPagination: builds filters and returns metadata', async () => {
        ormRepository.findAndCount.mockResolvedValue([[sampleTask], 1]);
        const result = await repository.findWithPagination({ page: 2, limit: 1, status: TaskStatus.PENDING, priority: TaskPriority.MEDIUM, userId: 'u1', sortBy: 'createdAt', sortOrder: 'ASC' });
        expect(ormRepository.findAndCount).toHaveBeenCalled();
        expect(result.total).toBe(1);
        expect(result.hasPreviousPage).toBe(true);
    });

    it('update: merges and saves via manager', async () => {
        (dataSource.manager.findOne as jest.Mock).mockResolvedValue(sampleTask);
        (dataSource.manager.save as jest.Mock).mockResolvedValue({ ...sampleTask, title: 'New' });
        const updated = await repository.update('t1', { title: 'New' });
        expect(updated.title).toBe('New');
    });

    it('update: throws when not found', async () => {
        (dataSource.manager.findOne as jest.Mock).mockResolvedValue(null);
        await expect(repository.update('x', { title: 'n' })).rejects.toThrow('Task with ID x not found');
    });

    it('updateStatus: uses orm update', async () => {
        ormRepository.update.mockResolvedValue({} as any);
        await repository.updateStatus('t1', TaskStatus.COMPLETED);
        expect(ormRepository.update).toHaveBeenCalledWith('t1', { status: TaskStatus.COMPLETED });
    });

    it('delete: removes via manager', async () => {
        (dataSource.manager.findOne as jest.Mock).mockResolvedValue(sampleTask);
        (dataSource.manager.remove as jest.Mock).mockResolvedValue(undefined);
        await repository.delete('t1');
        expect(dataSource.manager.remove).toHaveBeenCalled();
    });

    it('getStatistics: counts various facets', async () => {
        ormRepository.count
            .mockResolvedValueOnce(10)
            .mockResolvedValueOnce(4)
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(2);
        const stats = await repository.getStatistics();
        expect(stats.total).toBe(10);
        expect(stats.completed).toBe(4);
    });
});


