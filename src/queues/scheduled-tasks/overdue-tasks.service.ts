import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
export class OverdueTasksService {
  private readonly logger = new Logger(OverdueTasksService.name);

  constructor(
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) { }

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    this.logger.debug('Checking for overdue tasks...');

    try {
      const now = new Date();
      const overdueTasks = await this.tasksRepository.find({
        where: {
          dueDate: LessThan(now),
          status: TaskStatus.PENDING,
        },
        relations: ['user'],
      });

      this.logger.log(`Found ${overdueTasks.length} overdue tasks`);

      if (overdueTasks.length > 0) {
        // Process overdue tasks in batches to avoid overwhelming the queue
        const batchSize = 50;
        const batches = [];

        for (let i = 0; i < overdueTasks.length; i += batchSize) {
          batches.push(overdueTasks.slice(i, i + batchSize));
        }

        // Add each batch to the queue
        for (const batch of batches) {
          await this.taskQueue.add('overdue-tasks-notification', {
            tasks: batch.map(task => ({
              id: task.id,
              title: task.title,
              dueDate: task.dueDate,
              userId: task.userId,
              userEmail: task.user?.email,
            })),
            timestamp: now.toISOString(),
          });
        }

        this.logger.log(`Queued ${overdueTasks.length} overdue tasks for processing in ${batches.length} batches`);
      }

      this.logger.debug('Overdue tasks check completed');
    } catch (error) {
      this.logger.error('Error checking overdue tasks:', error);
    }
  }
} 