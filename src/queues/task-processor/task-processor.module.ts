import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TaskProcessorService } from './task-processor.service';
import { TaskProcessorController } from './task-processor.controller';
import { TasksModule } from '../../modules/tasks/tasks.module';
import { ConcurrencyControlService } from '../../common/services/concurrency-control.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'task-processing',
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 20,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        delay: 0,
        priority: 0,
      },
    }),
    BullModule.registerQueue({
      name: 'dead-letter',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
        delay: 0,
      },
    }),
    TasksModule,
  ],
  controllers: [TaskProcessorController],
  providers: [TaskProcessorService, ConcurrencyControlService],
  exports: [TaskProcessorService, ConcurrencyControlService],
})
export class TaskProcessorModule { } 