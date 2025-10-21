import { IsOptional, IsPositive, Max, Min, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationDto {
    @ApiPropertyOptional({
        description: 'Page number (1-based)',
        example: 1,
        minimum: 1
    })
    @IsOptional()
    @Type(() => Number)
    @IsPositive()
    page?: number = 1;

    @ApiPropertyOptional({
        description: 'Number of items per page',
        example: 10,
        minimum: 1,
        maximum: 100
    })
    @IsOptional()
    @Type(() => Number)
    @IsPositive()
    @Min(1)
    @Max(100)
    limit?: number = 10;
}

export class TaskFilterDto extends PaginationDto {
    @ApiPropertyOptional({
        description: 'Filter by task status',
        example: 'PENDING'
    })
    @IsOptional()
    status?: string;

    @ApiPropertyOptional({
        description: 'Filter by task priority',
        example: 'HIGH'
    })
    @IsOptional()
    priority?: string;

    @ApiPropertyOptional({
        description: 'Filter by user ID',
        example: '123e4567-e89b-12d3-a456-426614174000'
    })
    @IsOptional()
    userId?: string;

    @ApiPropertyOptional({
        description: 'Field to sort by',
        example: 'createdAt',
        enum: ['createdAt', 'updatedAt', 'title', 'dueDate', 'priority', 'status']
    })
    @IsOptional()
    @IsString()
    @IsIn(['createdAt', 'updatedAt', 'title', 'dueDate', 'priority', 'status'])
    sortBy?: string;

    @ApiPropertyOptional({
        description: 'Sort order',
        example: 'DESC',
        enum: ['ASC', 'DESC']
    })
    @IsOptional()
    @IsString()
    @IsIn(['ASC', 'DESC'])
    sortOrder?: 'ASC' | 'DESC';
}
