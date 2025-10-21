import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ResourceOwnershipGuard } from '../../common/guards/resource-ownership.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TaskStatus } from './enums/task-status.enum';

describe('TasksController', () => {
    let controller: TasksController;
    let service: jest.Mocked<TasksService>;

    beforeEach(async () => {
        service = {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            getTaskStatistics: jest.fn(),
            getPaginationInfo: jest.fn(),
            batchProcess: jest.fn(),
        } as any;

        const moduleBuilder = Test.createTestingModule({
            controllers: [TasksController],
            providers: [
                { provide: TasksService, useValue: service },
            ],
        })
            .overrideGuard(RateLimitGuard)
            .useValue({ canActivate: jest.fn().mockReturnValue(true) })
            .overrideGuard(ResourceOwnershipGuard)
            .useValue({ canActivate: jest.fn().mockReturnValue(true) })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: jest.fn().mockReturnValue(true) });

        const module: TestingModule = await moduleBuilder.compile();

        controller = module.get(TasksController);
    });

    it('create delegates to service', async () => {
        service.create.mockResolvedValue({ id: '1' });
        const result = await controller.create({ title: 'x' } as any);
        expect(service.create).toHaveBeenCalled();
        expect(result).toEqual({ id: '1' });
    });

    it('findAll delegates to service', async () => {
        service.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10 });
        const result = await controller.findAll({} as any);
        expect(service.findAll).toHaveBeenCalled();
        expect(result.total).toBe(0);
    });

    it('getStats delegates to service', async () => {
        service.getTaskStatistics.mockResolvedValue({ total: 1, completed: 0, inProgress: 0, pending: 1, highPriority: 0 });
        const res = await controller.getStats();
        expect(res.total).toBe(1);
    });

    it('getPaginationInfo delegates to service', async () => {
        service.getPaginationInfo.mockResolvedValue({ total: 0, totalPages: 0, page: 1, limit: 10, hasNextPage: false, hasPreviousPage: false });
        const res = await controller.getPaginationInfo({} as any);
        expect(res.page).toBe(1);
    });

    it('findOne delegates to service', async () => {
        service.findOne.mockResolvedValue({ id: '1' } as any);
        const res = await controller.findOne('1');
        expect(res).toEqual({ id: '1' });
    });

    it('update delegates to service', async () => {
        service.update.mockResolvedValue({ id: '1', status: TaskStatus.IN_PROGRESS } as any);
        const res = await controller.update('1', { status: TaskStatus.IN_PROGRESS } as any);
        expect(res.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('remove returns confirmation after service call', async () => {
        service.remove.mockResolvedValue(undefined);
        const res = await controller.remove('1');
        expect(res).toEqual({ message: 'Task deleted successfully' });
    });

    it('batchProcess validates and delegates', async () => {
        service.batchProcess.mockResolvedValue([{ taskId: '1', success: true, action: 'completed' }]);
        const res = await controller.batchProcess({ tasks: ['1'], action: 'complete' });
        expect(service.batchProcess).toHaveBeenCalledWith(['1'], 'complete', undefined);
        expect(res[0].success).toBe(true);
    });
});


