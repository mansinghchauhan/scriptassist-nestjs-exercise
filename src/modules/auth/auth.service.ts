import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenService } from './services/token.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly tokenService: TokenService,
  ) { }

  async login(loginDto: LoginDto, ipAddress?: string) {
    const { email, password } = loginDto;

    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email');
    }

    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    const tokenPair = await this.tokenService.generateTokenPair(user, ipAddress || 'unknown');

    return {
      access_token: tokenPair.accessToken,
      refresh_token: tokenPair.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  async register(registerDto: RegisterDto, ipAddress?: string) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    try {
      const user = await this.usersService.create(registerDto);
      const tokenPair = await this.tokenService.generateTokenPair(user, ipAddress || 'unknown');

      return {
        access_token: tokenPair.accessToken,
        refresh_token: tokenPair.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    } catch (error) {
      throw new BadRequestException('Failed to create user');
    }
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto, ipAddress?: string) {
    try {
      const tokenPair = await this.tokenService.refreshAccessToken(
        refreshTokenDto.refreshToken,
        ipAddress || 'unknown'
      );

      return {
        access_token: tokenPair.accessToken,
        refresh_token: tokenPair.refreshToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(refreshToken: string) {
    await this.tokenService.revokeRefreshToken(refreshToken);
    return { message: 'Logged out successfully' };
  }

  private generateToken(userId: string) {
    const payload = { sub: userId };
    return this.jwtService.sign(payload);
  }

  async validateUser(userId: string): Promise<any> {
    const user = await this.usersService.findOne(userId);

    if (!user) {
      return null;
    }

    return user;
  }

  async validateUserRoles(userId: string, requiredRoles: string[]): Promise<boolean> {
    const user = await this.usersService.findOne(userId);

    if (!user) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
} 