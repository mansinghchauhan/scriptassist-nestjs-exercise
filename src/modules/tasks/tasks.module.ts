import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { Task } from './entities/task.entity';
import { TaskRepository } from './repositories/task.repository';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CacheService } from '../../common/services/cache.service';
import { TransactionManager } from '../../common/services/transaction-manager.service';
import { ResourceOwnershipGuard } from '../../common/guards/resource-ownership.guard';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { RedisConnectionService } from '../../common/services/redis-connection.service';
import { RedisPartitioningService } from '../../common/services/redis-partitioning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task]),
    BullModule.registerQueue({
      name: 'task-processing',
    }),
    AuthModule,
    UsersModule,
    RedisModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TaskRepository,
    CacheService,
    TransactionManager,
    ResourceOwnershipGuard,
    RateLimitService,
    RedisConnectionService,
    RedisPartitioningService,
  ],
  exports: [TasksService],
})
export class TasksModule { } 