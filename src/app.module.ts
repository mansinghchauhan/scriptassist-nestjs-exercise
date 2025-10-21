import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@nestjs-modules/ioredis';
import { UsersModule } from './modules/users/users.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuthModule } from './modules/auth/auth.module';
import { TaskProcessorModule } from './queues/task-processor/task-processor.module';
import { ScheduledTasksModule } from './queues/scheduled-tasks/scheduled-tasks.module';
import { HealthModule } from './common/health/health.module';
import jwtConfig from './config/jwt.config';
import rateLimitConfig from './config/rate-limit.config';
import redisConfig from './config/redis.config';
import { RateLimitService } from './common/services/rate-limit.service';
import { RedisConnectionService } from './common/services/redis-connection.service';
import { RedisPartitioningService } from './common/services/redis-partitioning.service';
import { PerformanceMonitorService } from './common/services/performance-monitor.service';
import { DistributedLockService } from './common/services/distributed-lock.service';
import { HttpClientService } from './common/services/http-client.service';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [jwtConfig, rateLimitConfig, redisConfig],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),

    // Redis configuration - using our custom connection service
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.get('redis');
        return redisConfig || {
          type: 'single',
          options: {
            host: configService.get('REDIS_HOST', 'localhost'),
            port: parseInt(configService.get('REDIS_PORT') || '6379', 10),
            retryDelayOnFailover: 100,
            enableReadyCheck: false,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
          },
        };
      },
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Queue
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
        },
      }),
    }),

    // Rate limiting is now handled by our custom RateLimitService and RateLimitGuard

    // Feature modules
    UsersModule,
    TasksModule,
    AuthModule,

    // Queue processing modules
    TaskProcessorModule,
    ScheduledTasksModule,

    // Health check module
    HealthModule,
  ],
  providers: [
    RateLimitService, // Global rate limit service
    RedisConnectionService, // Distributed Redis connection management
    RedisPartitioningService, // Redis data partitioning service
    PerformanceMonitorService, // Global performance metrics service
    DistributedLockService,
    HttpClientService,
  ],
  exports: [
    RateLimitService,
    RedisConnectionService,
    RedisPartitioningService,
    PerformanceMonitorService,
    DistributedLockService,
    HttpClientService,
  ]
})
export class AppModule { } 