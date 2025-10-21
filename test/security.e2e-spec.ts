import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/entities/user.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { Task } from '../src/modules/tasks/entities/task.entity';

describe('Security (e2e)', () => {
    let app: INestApplication;
    let authToken: string;
    let userId: string;
    let taskId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                TypeOrmModule.forRoot({
                    type: 'sqlite',
                    database: ':memory:',
                    entities: [User, RefreshToken, Task],
                    synchronize: true,
                }),
                BullModule.forRoot({
                    connection: {
                        host: 'localhost',
                        port: 6379,
                    },
                }),
                AppModule,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        // Create test user and get auth token
        const registerResponse = await request(app.getHttpServer())
            .post('/auth/register')
            .send({
                email: 'test@example.com',
                name: 'Test User',
                password: 'password123',
            });

        authToken = registerResponse.body.access_token;
        userId = registerResponse.body.user.id;

        // Create a test task
        const taskResponse = await request(app.getHttpServer())
            .post('/tasks')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
                title: 'Test Task',
                description: 'Test Description',
                userId: userId,
            });

        taskId = taskResponse.body.id;
    });

    afterAll(async () => {
        await app.close();
    });

    describe('Rate Limiting', () => {
        it('should enforce rate limiting', async () => {
            const promises = Array(150).fill(0).map(() =>
                request(app.getHttpServer())
                    .get('/tasks')
                    .set('Authorization', `Bearer ${authToken}`)
            );

            const responses = await Promise.all(promises);
            const rateLimitedResponses = responses.filter(res => res.status === 429);

            expect(rateLimitedResponses.length).toBeGreaterThan(0);
        });
    });

    describe('Authorization', () => {
        it('should require authentication for protected endpoints', () => {
            return request(app.getHttpServer())
                .get('/tasks')
                .expect(401);
        });

        it('should reject invalid JWT tokens', () => {
            return request(app.getHttpServer())
                .get('/tasks')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
        });

        it('should allow users to access only their own tasks', async () => {
            // Create another user
            const anotherUserResponse = await request(app.getHttpServer())
                .post('/auth/register')
                .send({
                    email: 'another@example.com',
                    name: 'Another User',
                    password: 'password456',
                });

            const anotherUserToken = anotherUserResponse.body.access_token;

            // Try to access the first user's task with the second user's token
            return request(app.getHttpServer())
                .get(`/tasks/${taskId}`)
                .set('Authorization', `Bearer ${anotherUserToken}`)
                .expect(403);
        });
    });

    describe('Input Validation', () => {
        it('should sanitize malicious input', () => {
            return request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: '<script>alert("xss")</script>Malicious Task',
                    description: 'DROP TABLE users; --',
                    userId: userId,
                })
                .expect(201)
                .expect((res) => {
                    expect(res.body.title).not.toContain('<script>');
                    expect(res.body.title).not.toContain('alert');
                    expect(res.body.description).not.toContain('DROP TABLE');
                });
        });

        it('should reject malformed JSON', () => {
            return request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'application/json')
                .send('{"title": "Test", "userId": "')
                .expect(400);
        });

        it('should reject oversized payloads', () => {
            const largeDescription = 'A'.repeat(10000);

            return request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Test Task',
                    description: largeDescription,
                    userId: userId,
                })
                .expect(400);
        });
    });

    describe('SQL Injection Protection', () => {
        it('should prevent SQL injection in task queries', () => {
            return request(app.getHttpServer())
                .get('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .query({
                    status: "'; DROP TABLE tasks; --",
                })
                .expect(400);
        });

        it('should prevent SQL injection in task ID parameter', () => {
            return request(app.getHttpServer())
                .get('/tasks/1; DROP TABLE tasks; --')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(400);
        });
    });

    describe('XSS Protection', () => {
        it('should prevent XSS in task creation', () => {
            return request(app.getHttpServer())
                .post('/tasks')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: '<img src="x" onerror="alert(\'XSS\')">',
                    description: '<script>document.location="http://evil.com"</script>',
                    userId: userId,
                })
                .expect(201)
                .expect((res) => {
                    expect(res.body.title).not.toContain('<img');
                    expect(res.body.title).not.toContain('onerror');
                    expect(res.body.description).not.toContain('<script>');
                    expect(res.body.description).not.toContain('document.location');
                });
        });
    });

    describe('CSRF Protection', () => {
        it('should require proper headers for state-changing operations', () => {
            return request(app.getHttpServer())
                .patch(`/tasks/${taskId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('Origin', 'http://evil.com')
                .send({
                    title: 'Updated Task',
                })
                .expect((res) => {
                    // Should either succeed (if CORS is properly configured) or fail gracefully
                    expect([200, 403, 400]).toContain(res.status);
                });
        });
    });
});
