import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { RedisConnectionService } from '../../common/services/redis-connection.service';
import { RedisPartitioningService } from '../../common/services/redis-partitioning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    RedisModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, RateLimitService, RedisConnectionService, RedisPartitioningService],
  exports: [UsersService],
})
export class UsersModule { } 