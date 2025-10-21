import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'token', unique: true })
    token: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ name: 'expires_at' })
    expiresAt: Date;

    @Column({ name: 'is_revoked', default: false })
    isRevoked: boolean;

    @Column({ name: 'created_by_ip' })
    createdByIp: string;

    @Column({ name: 'last_used_at', nullable: true })
    lastUsedAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
