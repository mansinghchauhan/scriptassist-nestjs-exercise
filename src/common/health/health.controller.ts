import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
    constructor(private readonly healthService: HealthService) { }

    @Get()
    @ApiOperation({ summary: 'Get application health status' })
    @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
    async getHealth() {
        return this.healthService.getHealth();
    }

    @Get('detailed')
    @ApiOperation({ summary: 'Get detailed health status including dependencies' })
    @ApiResponse({ status: 200, description: 'Detailed health status retrieved successfully' })
    async getDetailedHealth() {
        return this.healthService.getDetailedHealth();
    }

    @Get('liveness')
    @ApiOperation({ summary: 'Kubernetes liveness probe' })
    @ApiResponse({ status: 200, description: 'Service is alive' })
    async getLiveness() {
        return this.healthService.getLiveness();
    }

    @Get('readiness')
    @ApiOperation({ summary: 'Kubernetes readiness probe' })
    @ApiResponse({ status: 200, description: 'Service is ready to receive traffic' })
    async getReadiness() {
        return this.healthService.getReadiness();
    }

    @Get('metrics')
    @ApiOperation({ summary: 'Get runtime and performance metrics' })
    @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
    async getMetrics() {
        return this.healthService.getMetrics();
    }

    @Post('self-heal')
    @ApiOperation({ summary: 'Trigger self-healing routines (e.g., Redis reconnect)' })
    @ApiResponse({ status: 200, description: 'Self-heal triggered' })
    async selfHeal() {
        return this.healthService.selfHeal();
    }
}
