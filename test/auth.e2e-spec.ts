import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/entities/user.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';

describe('Auth (e2e)', () => {
    let app: INestApplication;
    let authToken: string;
    let refreshToken: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                TypeOrmModule.forRoot({
                    type: 'sqlite',
                    database: ':memory:',
                    entities: [User, RefreshToken],
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
    });

    afterAll(async () => {
        await app.close();
    });

    describe('/auth/register (POST)', () => {
        it('should register a new user', () => {
            return request(app.getHttpServer())
                .post('/auth/register')
                .send({
                    email: 'test@example.com',
                    name: 'Test User',
                    password: 'password123',
                })
                .expect(201)
                .expect((res) => {
                    expect(res.body).toHaveProperty('access_token');
                    expect(res.body).toHaveProperty('refresh_token');
                    expect(res.body).toHaveProperty('user');
                    expect(res.body.user.email).toBe('test@example.com');

                    authToken = res.body.access_token;
                    refreshToken = res.body.refresh_token;
                });
        });

        it('should return 409 for duplicate email', () => {
            return request(app.getHttpServer())
                .post('/auth/register')
                .send({
                    email: 'test@example.com',
                    name: 'Another User',
                    password: 'password456',
                })
                .expect(409);
        });

        it('should return 400 for invalid data', () => {
            return request(app.getHttpServer())
                .post('/auth/register')
                .send({
                    email: 'invalid-email',
                    name: '',
                    password: '123',
                })
                .expect(400);
        });
    });

    describe('/auth/login (POST)', () => {
        it('should login with valid credentials', () => {
            return request(app.getHttpServer())
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                })
                .expect(200)
                .expect((res) => {
                    expect(res.body).toHaveProperty('access_token');
                    expect(res.body).toHaveProperty('refresh_token');
                    expect(res.body).toHaveProperty('user');
                });
        });

        it('should return 401 for invalid credentials', () => {
            return request(app.getHttpServer())
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'wrongpassword',
                })
                .expect(401);
        });

        it('should return 401 for non-existent user', () => {
            return request(app.getHttpServer())
                .post('/auth/login')
                .send({
                    email: 'nonexistent@example.com',
                    password: 'password123',
                })
                .expect(401);
        });
    });

    describe('/auth/refresh (POST)', () => {
        it('should refresh access token with valid refresh token', () => {
            return request(app.getHttpServer())
                .post('/auth/refresh')
                .send({
                    refreshToken: refreshToken,
                })
                .expect(200)
                .expect((res) => {
                    expect(res.body).toHaveProperty('access_token');
                    expect(res.body).toHaveProperty('refresh_token');
                    expect(res.body.access_token).not.toBe(authToken);
                });
        });

        it('should return 401 for invalid refresh token', () => {
            return request(app.getHttpServer())
                .post('/auth/refresh')
                .send({
                    refreshToken: 'invalid-token',
                })
                .expect(401);
        });
    });

    describe('/auth/logout (POST)', () => {
        it('should logout and revoke refresh token', () => {
            return request(app.getHttpServer())
                .post('/auth/logout')
                .send({
                    refreshToken: refreshToken,
                })
                .expect(200)
                .expect((res) => {
                    expect(res.body).toHaveProperty('message', 'Logged out successfully');
                });
        });

        it('should not be able to use revoked refresh token', () => {
            return request(app.getHttpServer())
                .post('/auth/refresh')
                .send({
                    refreshToken: refreshToken,
                })
                .expect(401);
        });
    });
});
