import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, HttpException, HttpStatus } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/pagination.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit, RateLimits } from '../../common/decorators/rate-limit.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ResourceOwnershipGuard } from '../../common/guards/resource-ownership.guard';
import { ResourceOwner } from '../../common/decorators/resource-ownership.decorator';

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RateLimitGuard, ResourceOwnershipGuard)
@RateLimit(RateLimits.TASKS)
@ApiBearerAuth()
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  create(@Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(createTaskDto);
  }

  @Get()
  @ApiOperation({ summary: 'Find all tasks with optional filtering and pagination' })
  async findAll(@Query() filterDto: TaskFilterDto) {
    return this.tasksService.findAll(filterDto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get task statistics' })
  async getStats() {
    return this.tasksService.getTaskStatistics();
  }

  @Get('pagination')
  @ApiOperation({ summary: 'Get pagination information for tasks' })
  async getPaginationInfo(@Query() filterDto: TaskFilterDto) {
    return this.tasksService.getPaginationInfo(filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find a task by ID' })
  @ResourceOwner({ resourceType: 'task', allowAdmin: true })
  async findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ResourceOwner({ resourceType: 'task', allowAdmin: true })
  update(@Param('id') id: string, @Body() updateTaskDto: UpdateTaskDto) {
    return this.tasksService.update(id, updateTaskDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ResourceOwner({ resourceType: 'task', allowAdmin: true })
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
    return { message: 'Task deleted successfully' };
  }

  @Post('batch')
  @ApiOperation({ summary: 'Batch process multiple tasks' })
  async batchProcess(@Body() operations: { tasks: string[], action: string, status?: string }) {
    const { tasks: taskIds, action, status } = operations;

    if (!taskIds || taskIds.length === 0) {
      throw new HttpException('No tasks provided', HttpStatus.BAD_REQUEST);
    }

    if (!['complete', 'delete', 'update'].includes(action)) {
      throw new HttpException(`Invalid action: ${action}`, HttpStatus.BAD_REQUEST);
    }

    if (action === 'update' && !status) {
      throw new HttpException('Status is required for update action', HttpStatus.BAD_REQUEST);
    }

    try {
      const results = await this.tasksService.batchProcess(taskIds, action, status as any);
      return results;
    } catch (error) {
      throw new HttpException('Batch processing failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 