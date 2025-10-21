import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisConnectionService } from '../services/redis-connection.service';
import { RedisPartitioningService } from '../services/redis-partitioning.service';
import { PerformanceMonitorService } from '../services/performance-monitor.service';

@Module({
    imports: [
        TypeOrmModule,
        RedisModule,
    ],
    controllers: [HealthController],
    providers: [HealthService, RedisConnectionService, RedisPartitioningService, PerformanceMonitorService],
})
export class HealthModule { }
