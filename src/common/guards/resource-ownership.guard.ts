import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../modules/users/users.service';
import { TasksService } from '../../modules/tasks/tasks.service';

export const RESOURCE_OWNER_KEY = 'resourceOwner';

export interface ResourceOwnershipOptions {
    resourceType: 'task' | 'user';
    paramName?: string;
    allowAdmin?: boolean;
}

@Injectable()
export class ResourceOwnershipGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private usersService: UsersService,
        private tasksService: TasksService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const options = this.reflector.getAllAndOverride<ResourceOwnershipOptions>(
            RESOURCE_OWNER_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (!options) {
            return true; // No resource ownership check required
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new ForbiddenException('User not authenticated');
        }

        const resourceId = request.params[options.paramName || 'id'];

        if (!resourceId) {
            throw new ForbiddenException('Resource ID not found');
        }

        // Allow admin users to access any resource
        if (options.allowAdmin && user.role === 'admin') {
            return true;
        }

        // Check ownership based on resource type
        switch (options.resourceType) {
            case 'task':
                return this.checkTaskOwnership(user.id, resourceId);
            case 'user':
                return this.checkUserOwnership(user.id, resourceId);
            default:
                throw new ForbiddenException('Unknown resource type');
        }
    }

    private async checkTaskOwnership(userId: string, taskId: string): Promise<boolean> {
        try {
            const task = await this.tasksService.findOne(taskId);
            return task.userId === userId;
        } catch (error) {
            throw new ForbiddenException('Task not found or access denied');
        }
    }

    private async checkUserOwnership(userId: string, targetUserId: string): Promise<boolean> {
        return userId === targetUserId;
    }
}
