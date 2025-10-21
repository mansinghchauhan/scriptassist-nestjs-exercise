/* istanbul ignore file */
import { Injectable, Logger } from '@nestjs/common';
import { RedisConnectionService } from './redis-connection.service';
import { createHash } from 'crypto';

export interface PartitioningStrategy {
    getPartition(key: string, totalPartitions: number): number;
    getNodeForPartition(partition: number, nodes: string[]): string;
    getNodeForKey(key: string): string;
}

export class ConsistentHashingStrategy implements PartitioningStrategy {
    private readonly virtualNodes = 160; // Number of virtual nodes per physical node
    private readonly ring: Array<{ hash: number; node: string }> = [];

    constructor(private readonly nodes: string[]) {
        this.buildRing();
    }

    private buildRing(): void {
        for (const node of this.nodes) {
            for (let i = 0; i < this.virtualNodes; i++) {
                const hash = this.hash(`${node}:${i}`);
                this.ring.push({ hash, node });
            }
        }
        this.ring.sort((a, b) => a.hash - b.hash);
    }

    private hash(key: string): number {
        return parseInt(createHash('md5').update(key).digest('hex').substring(0, 8), 16);
    }

    getPartition(key: string, totalPartitions: number): number {
        const hash = this.hash(key);
        return hash % totalPartitions;
    }

    getNodeForPartition(partition: number, nodes: string[]): string {
        const hash = this.hash(`partition:${partition}`);

        // Find the first node with hash >= partition hash
        for (const ringNode of this.ring) {
            if (ringNode.hash >= hash) {
                return ringNode.node;
            }
        }

        // Wrap around to the first node
        return this.ring[0].node;
    }

    getNodeForKey(key: string): string {
        const hash = this.hash(key);

        // Find the first node with hash >= key hash
        for (const ringNode of this.ring) {
            if (ringNode.hash >= hash) {
                return ringNode.node;
            }
        }

        // Wrap around to the first node
        return this.ring[0].node;
    }
}

export class RangeBasedStrategy implements PartitioningStrategy {
    constructor(private readonly ranges: Array<{ start: number; end: number; node: string }>) { }

    getPartition(key: string, totalPartitions: number): number {
        const hash = this.hash(key);
        return hash % totalPartitions;
    }

    getNodeForPartition(partition: number, nodes: string[]): string {
        for (const range of this.ranges) {
            if (partition >= range.start && partition <= range.end) {
                return range.node;
            }
        }
        return nodes[0]; // Fallback to first node
    }

    getNodeForKey(key: string): string {
        const partition = this.getPartition(key, 1000); // Use a default total partitions value
        for (const range of this.ranges) {
            if (partition >= range.start && partition <= range.end) {
                return range.node;
            }
        }
        return this.ranges[0]?.node || 'default-node'; // Fallback to first range node or default
    }

    private hash(key: string): number {
        return parseInt(createHash('md5').update(key).digest('hex').substring(0, 8), 16);
    }
}

@Injectable()
export class RedisPartitioningService {
    private readonly logger = new Logger(RedisPartitioningService.name);
    private partitioningStrategy: PartitioningStrategy;
    private readonly totalPartitions: number;
    private readonly nodes: string[];

    constructor(private readonly redisConnectionService: RedisConnectionService) {
        // Initialize with default nodes - in production, this would come from configuration
        this.nodes = [
            'redis-node-1:6379',
            'redis-node-2:6379',
            'redis-node-3:6379',
        ];
        this.totalPartitions = 1000; // Total number of partitions
        this.partitioningStrategy = new ConsistentHashingStrategy(this.nodes);
    }

    /**
     * Get the appropriate Redis connection for a given key
     */
    getConnectionForKey(key: string): any {
        if (!this.redisConnectionService.isHealthy()) {
            throw new Error('Redis connection is not healthy');
        }

        const node = this.partitioningStrategy.getNodeForKey(key);
        this.logger.debug(`Key '${key}' mapped to node: ${node}`);

        // In a real implementation, you would return the specific connection
        // For now, we return the main connection as we're using a single Redis instance
        return this.redisConnectionService.getConnection();
    }

    /**
     * Get the partition number for a given key
     */
    getPartitionForKey(key: string): number {
        return this.partitioningStrategy.getPartition(key, this.totalPartitions);
    }

    /**
     * Get the node responsible for a specific partition
     */
    getNodeForPartition(partition: number): string {
        return this.partitioningStrategy.getNodeForPartition(partition, this.nodes);
    }

    /**
     * Distribute keys across partitions for batch operations
     */
    distributeKeys(keys: string[]): Map<string, string[]> {
        const distribution = new Map<string, string[]>();

        for (const key of keys) {
            const node = this.partitioningStrategy.getNodeForKey(key);
            if (!distribution.has(node)) {
                distribution.set(node, []);
            }
            distribution.get(node)!.push(key);
        }

        return distribution;
    }

    /**
     * Get all nodes in the cluster
     */
    getNodes(): string[] {
        return [...this.nodes];
    }

    /**
     * Get the total number of partitions
     */
    getTotalPartitions(): number {
        return this.totalPartitions;
    }

    /**
     * Check if a key belongs to a specific node
     */
    isKeyOnNode(key: string, node: string): boolean {
        const assignedNode = this.partitioningStrategy.getNodeForKey(key);
        return assignedNode === node;
    }

    /**
     * Get statistics about key distribution
     */
    getDistributionStats(keys: string[]): {
        totalKeys: number;
        nodeDistribution: Map<string, number>;
        partitionDistribution: Map<number, number>;
        averageKeysPerNode: number;
        averageKeysPerPartition: number;
    } {
        const nodeDistribution = new Map<string, number>();
        const partitionDistribution = new Map<number, number>();

        for (const key of keys) {
            const node = this.partitioningStrategy.getNodeForKey(key);
            const partition = this.partitioningStrategy.getPartition(key, this.totalPartitions);

            nodeDistribution.set(node, (nodeDistribution.get(node) || 0) + 1);
            partitionDistribution.set(partition, (partitionDistribution.get(partition) || 0) + 1);
        }

        const totalKeys = keys.length;
        const averageKeysPerNode = totalKeys / this.nodes.length;
        const averageKeysPerPartition = totalKeys / this.totalPartitions;

        return {
            totalKeys,
            nodeDistribution,
            partitionDistribution,
            averageKeysPerNode,
            averageKeysPerPartition,
        };
    }

    /**
     * Rebalance keys when nodes are added or removed
     */
    rebalanceKeys(keys: string[], newNodes: string[]): Map<string, string[]> {
        this.logger.log(`Rebalancing ${keys.length} keys across ${newNodes.length} nodes`);

        // Create new partitioning strategy with updated nodes
        this.partitioningStrategy = new ConsistentHashingStrategy(newNodes);
        this.nodes.splice(0, this.nodes.length, ...newNodes);

        // Redistribute keys
        return this.distributeKeys(keys);
    }

    /**
     * Get keys that need to be migrated when a node is removed
     */
    getKeysToMigrate(removedNode: string, allKeys: string[]): string[] {
        const keysToMigrate: string[] = [];

        for (const key of allKeys) {
            const currentNode = this.partitioningStrategy.getNodeForKey(key);
            if (currentNode === removedNode) {
                keysToMigrate.push(key);
            }
        }

        this.logger.log(`Found ${keysToMigrate.length} keys to migrate from node ${removedNode}`);
        return keysToMigrate;
    }

    /**
     * Validate that all keys are properly distributed
     */
    validateDistribution(keys: string[]): {
        isValid: boolean;
        issues: string[];
        stats: ReturnType<RedisPartitioningService['getDistributionStats']>;
    } {
        const issues: string[] = [];
        const stats = this.getDistributionStats(keys);

        // Check for empty nodes
        for (const node of this.nodes) {
            if (!stats.nodeDistribution.has(node) || stats.nodeDistribution.get(node) === 0) {
                issues.push(`Node ${node} has no keys assigned`);
            }
        }

        // Check for heavily loaded nodes (more than 2x average)
        const maxKeysPerNode = Math.max(...Array.from(stats.nodeDistribution.values()));
        if (maxKeysPerNode > stats.averageKeysPerNode * 2) {
            issues.push(`Some nodes are heavily loaded (max: ${maxKeysPerNode}, avg: ${stats.averageKeysPerNode.toFixed(2)})`);
        }

        // Check for empty partitions
        const emptyPartitions = this.totalPartitions - stats.partitionDistribution.size;
        if (emptyPartitions > 0) {
            issues.push(`${emptyPartitions} partitions have no keys assigned`);
        }

        return {
            isValid: issues.length === 0,
            issues,
            stats,
        };
    }
}
