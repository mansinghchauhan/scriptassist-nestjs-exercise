import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TaskProcessorService, JobMetrics } from './task-processor.service';
import { ConcurrencyControlService } from '../../common/services/concurrency-control.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';

interface UpdateConcurrencyDto {
    jobType: string;
    maxConcurrent: number;
}

interface HealthResponse {
    healthy: boolean;
    metrics: JobMetrics;
    concurrencyStatus: any;
    timestamp: string;
}

@ApiTags('task-processor')
@Controller('task-processor')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TaskProcessorController {
    constructor(
        private readonly taskProcessorService: TaskProcessorService,
        private readonly concurrencyControl: ConcurrencyControlService,
    ) { }

    @Get('metrics')
    @ApiOperation({ summary: 'Get task processor metrics' })
    @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
    getMetrics(): JobMetrics {
        return this.taskProcessorService.getMetrics();
    }

    @Get('concurrency-status')
    @ApiOperation({ summary: 'Get concurrency control status' })
    @ApiResponse({ status: 200, description: 'Concurrency status retrieved successfully' })
    getConcurrencyStatus() {
        return this.concurrencyControl.getStatus();
    }

    @Post('concurrency-limits')
    @ApiOperation({ summary: 'Update concurrency limits for a job type' })
    @ApiResponse({ status: 200, description: 'Concurrency limits updated successfully' })
    updateConcurrencyLimits(@Body() updateDto: UpdateConcurrencyDto) {
        this.concurrencyControl.updateLimits(updateDto.jobType, updateDto.maxConcurrent);
        return {
            success: true,
            message: `Updated concurrency limit for ${updateDto.jobType} to ${updateDto.maxConcurrent}`,
        };
    }

    @Post('reset-metrics')
    @ApiOperation({ summary: 'Reset task processor metrics' })
    @ApiResponse({ status: 200, description: 'Metrics reset successfully' })
    resetMetrics() {
        this.taskProcessorService.resetMetrics();
        return {
            success: true,
            message: 'Metrics reset successfully',
        };
    }

    @Post('reset-concurrency')
    @ApiOperation({ summary: 'Reset concurrency control' })
    @ApiResponse({ status: 200, description: 'Concurrency control reset successfully' })
    resetConcurrency() {
        this.concurrencyControl.reset();
        return {
            success: true,
            message: 'Concurrency control reset successfully',
        };
    }

    @Get('health')
    @ApiOperation({ summary: 'Get task processor health status' })
    @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
    getHealth(): HealthResponse {
        const metrics = this.taskProcessorService.getMetrics();
        const concurrencyStatus = this.concurrencyControl.getStatus();

        const isHealthy = metrics.failed / Math.max(metrics.processed, 1) < 0.1; // Less than 10% failure rate

        return {
            healthy: isHealthy,
            metrics,
            concurrencyStatus,
            timestamp: new Date().toISOString(),
        };
    }
}
