import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit, RateLimits } from '../../common/decorators/rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
@RateLimit(RateLimits.AUTH)
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @ApiOperation({ summary: 'Login user and get access token' })
  @RateLimit(RateLimits.LOGIN) // Stricter rate limiting for login attempts
  login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.login(loginDto, ipAddress);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register new user and get access token' })
  register(@Body() registerDto: RegisterDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.register(registerDto, ipAddress);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  refreshToken(@Body() refreshTokenDto: RefreshTokenDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.refreshToken(refreshTokenDto, ipAddress);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout user and revoke refresh token' })
  logout(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.logout(refreshTokenDto.refreshToken);
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    const realIp = req.headers['x-real-ip'] as string;
    const remoteAddress = req.connection?.remoteAddress || req.socket?.remoteAddress;

    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    if (realIp) {
      return realIp;
    }

    return remoteAddress || 'unknown';
  }
} 