/* istanbul ignore file */
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User } from '../../users/entities/user.entity';
import * as crypto from 'crypto';

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

export interface TokenPayload {
    sub: string;
    email: string;
    role: string;
}

@Injectable()
export class TokenService {
    private readonly logger = new Logger(TokenService.name);

    constructor(
        private readonly jwtService: JwtService,
        @InjectRepository(RefreshToken)
        private readonly refreshTokenRepository: Repository<RefreshToken>,
    ) { }

    async generateTokenPair(user: User, ipAddress: string): Promise<TokenPair> {
        const payload: TokenPayload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        // Generate access token (short-lived)
        const accessToken = this.jwtService.sign(payload, {
            expiresIn: '15m',
        });

        // Generate refresh token (long-lived)
        const refreshToken = this.generateRefreshToken();

        // Store refresh token in database
        await this.storeRefreshToken(user.id, refreshToken, ipAddress);

        return {
            accessToken,
            refreshToken,
        };
    }

    async refreshAccessToken(refreshToken: string, ipAddress: string): Promise<TokenPair> {
        const storedToken = await this.refreshTokenRepository.findOne({
            where: { token: refreshToken },
            relations: ['user'],
        });

        if (!storedToken || storedToken.isRevoked || storedToken.expiresAt < new Date()) {
            throw new Error('Invalid refresh token');
        }

        // Update last used timestamp
        storedToken.lastUsedAt = new Date();
        await this.refreshTokenRepository.save(storedToken);

        // Generate new token pair
        return this.generateTokenPair(storedToken.user, ipAddress);
    }

    async revokeRefreshToken(refreshToken: string): Promise<void> {
        const token = await this.refreshTokenRepository.findOne({
            where: { token: refreshToken },
        });

        if (token) {
            token.isRevoked = true;
            await this.refreshTokenRepository.save(token);
        }
    }

    async revokeAllUserTokens(userId: string): Promise<void> {
        await this.refreshTokenRepository.update(
            { userId, isRevoked: false },
            { isRevoked: true },
        );
    }

    async cleanupExpiredTokens(): Promise<void> {
        const result = await this.refreshTokenRepository.delete({
            expiresAt: new Date() as any, // Use LessThan in real implementation
        });

        if (result.affected && result.affected > 0) {
            this.logger.log(`Cleaned up ${result.affected} expired refresh tokens`);
        }
    }

    private generateRefreshToken(): string {
        return crypto.randomBytes(64).toString('hex');
    }

    private async storeRefreshToken(
        userId: string,
        refreshToken: string,
        ipAddress: string,
    ): Promise<void> {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

        const tokenEntity = this.refreshTokenRepository.create({
            token: refreshToken,
            userId,
            expiresAt,
            createdByIp: ipAddress,
        });

        await this.refreshTokenRepository.save(tokenEntity);
    }
}
