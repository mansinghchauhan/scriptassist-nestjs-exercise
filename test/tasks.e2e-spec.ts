import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '@nestjs-modules/ioredis';
import { JwtModule } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { Task } from '../src/modules/tasks/entities/task.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { TaskStatus } from '../src/modules/tasks/enums/task-status.enum';
import { TaskPriority } from '../src/modules/tasks/enums/task-priority.enum';

describe('Tasks (e2e)', () => {
    let app: INestApplication;
    let authToken: string;
    let userId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                TypeOrmModule.forRoot({
                    type: 'sqlite',
                    database: ':memory:',
                    entities: [Task, User],
                    synchronize: true,
                }),
                BullModule.forRoot({
                    connection: {
                        host: 'localhost',
                        port: 6379,
                    },
                }),
                // RedisModule.forRoot({
                //   host: 'localhost',
                //   port: 6379,
                // }),
                JwtModule.register({
                    secret: 'test-secret',
                    signOptions: { expiresIn: '1h' },
                }),
                AppModule,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        // Create a test user and get auth token
        const registerResponse = await request(app.getHttpServer())
            .post('/auth/register')
            .send({
                email: 'test@example.com',
                name: 'Test User',
                password: 'password123',
            });

        authToken = registerResponse.body.access_token;
        userId = registerResponse.body.user.id;
    });

    afterAll(async () => {
        await app.close();
    });

    describe('/tasks (POST)', () => {
        it('should create a task', () => {
            return request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Test Task',
                    description: 'Test Description',
                    userId: userId,
                    status: TaskStatus.PENDING,
                    priority: TaskPriority.MEDIUM,
                })
                .expect(201)
                .expect((res) => {
                    expect(res.body.title).toBe('Test Task');
                    expect(res.body.description).toBe('Test Description');
                    expect(res.body.userId).toBe(userId);
                });
        });

        it('should return 401 without auth token', () => {
            return request(app.getHttpServer())
                .post('/tasks')
                .send({
                    title: 'Test Task',
                    description: 'Test Description',
                    userId: userId,
                })
                .expect(401);
        });

        it('should return 400 for invalid data', () => {
            return request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: '', // Invalid: empty title
                    userId: userId,
                })
                .expect(400);
        });
    });

    describe('/tasks (GET)', () => {
        it('should return tasks with pagination', () => {
            return request(app.getHttpServer())
                .get('/tasks?page=1&limit=10')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body).toHaveProperty('data');
                    expect(res.body).toHaveProperty('total');
                    expect(res.body).toHaveProperty('page');
                    expect(res.body).toHaveProperty('limit');
                    expect(Array.isArray(res.body.data)).toBe(true);
                });
        });

        it('should filter tasks by status', () => {
            return request(app.getHttpServer())
                .get('/tasks?status=PENDING')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body.data.every((task: any) => task.status === 'PENDING')).toBe(true);
                });
        });

        it('should filter tasks by priority', () => {
            return request(app.getHttpServer())
                .get('/tasks?priority=HIGH')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body.data.every((task: any) => task.priority === 'HIGH')).toBe(true);
                });
        });
    });

    describe('/tasks/stats (GET)', () => {
        it('should return task statistics', () => {
            return request(app.getHttpServer())
                .get('/tasks/stats')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body).toHaveProperty('total');
                    expect(res.body).toHaveProperty('completed');
                    expect(res.body).toHaveProperty('inProgress');
                    expect(res.body).toHaveProperty('pending');
                    expect(res.body).toHaveProperty('highPriority');
                    expect(typeof res.body.total).toBe('number');
                });
        });
    });

    describe('/tasks/:id (GET)', () => {
        let taskId: string;

        beforeAll(async () => {
            const response = await request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Test Task for GET',
                    description: 'Test Description',
                    userId: userId,
                });
            taskId = response.body.id;
        });

        it('should return a specific task', () => {
            return request(app.getHttpServer())
                .get(`/tasks/${taskId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body.id).toBe(taskId);
                    expect(res.body.title).toBe('Test Task for GET');
                });
        });

        it('should return 404 for non-existent task', () => {
            return request(app.getHttpServer())
                .get('/tasks/non-existent-id')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(404);
        });
    });

    describe('/tasks/:id (PATCH)', () => {
        let taskId: string;

        beforeAll(async () => {
            const response = await request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Test Task for UPDATE',
                    description: 'Test Description',
                    userId: userId,
                });
            taskId = response.body.id;
        });

        it('should update a task', () => {
            return request(app.getHttpServer())
                .patch(`/tasks/${taskId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Updated Task Title',
                    status: TaskStatus.IN_PROGRESS,
                })
                .expect(200)
                .expect((res) => {
                    expect(res.body.title).toBe('Updated Task Title');
                    expect(res.body.status).toBe('IN_PROGRESS');
                });
        });

        it('should return 404 for non-existent task', () => {
            return request(app.getHttpServer())
                .patch('/tasks/non-existent-id')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Updated Title',
                })
                .expect(404);
        });
    });

    describe('/tasks/:id (DELETE)', () => {
        let taskId: string;

        beforeAll(async () => {
            const response = await request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Test Task for DELETE',
                    description: 'Test Description',
                    userId: userId,
                });
            taskId = response.body.id;
        });

        it('should delete a task', () => {
            return request(app.getHttpServer())
                .delete(`/tasks/${taskId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body.message).toBe('Task deleted successfully');
                });
        });

        it('should return 404 for non-existent task', () => {
            return request(app.getHttpServer())
                .delete('/tasks/non-existent-id')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(404);
        });
    });

    describe('/tasks/batch (POST)', () => {
        let taskIds: string[];

        beforeAll(async () => {
            const tasks = await Promise.all([
                request(app.getHttpServer())
                    .post('/tasks')
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        title: 'Batch Task 1',
                        userId: userId,
                    }),
                request(app.getHttpServer())
                    .post('/tasks')
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        title: 'Batch Task 2',
                        userId: userId,
                    }),
            ]);
            taskIds = tasks.map(res => res.body.id);
        });

        it('should complete multiple tasks', () => {
            return request(app.getHttpServer())
                .post('/tasks/batch')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    tasks: taskIds,
                    action: 'complete',
                })
                .expect(200)
                .expect((res) => {
                    expect(Array.isArray(res.body)).toBe(true);
                    expect(res.body).toHaveLength(2);
                    expect(res.body[0]).toHaveProperty('taskId');
                    expect(res.body[0]).toHaveProperty('success', true);
                    expect(res.body[0]).toHaveProperty('action', 'completed');
                });
        });

        it('should return 400 for invalid action', () => {
            return request(app.getHttpServer())
                .post('/tasks/batch')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    tasks: taskIds,
                    action: 'invalid-action',
                })
                .expect(400);
        });

        it('should return 400 for empty tasks array', () => {
            return request(app.getHttpServer())
                .post('/tasks/batch')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    tasks: [],
                    action: 'complete',
                })
                .expect(400);
        });
    });
});
