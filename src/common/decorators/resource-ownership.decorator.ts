import { SetMetadata } from '@nestjs/common';
import { RESOURCE_OWNER_KEY, ResourceOwnershipOptions } from '../guards/resource-ownership.guard';

export const ResourceOwner = (options: ResourceOwnershipOptions) =>
    SetMetadata(RESOURCE_OWNER_KEY, options);
