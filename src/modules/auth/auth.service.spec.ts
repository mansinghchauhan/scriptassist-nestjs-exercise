import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from './services/token.service';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
    let service: AuthService;
    let usersService: UsersService;
    let jwtService: JwtService;

    const mockUser = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        password: 'hashedPassword',
        role: 'user',
        tasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                {
                    provide: UsersService,
                    useValue: {
                        findByEmail: jest.fn(),
                        create: jest.fn(),
                        findOne: jest.fn(),
                    },
                },
                {
                    provide: JwtService,
                    useValue: {
                        sign: jest.fn(),
                    },
                },
                {
                    provide: TokenService,
                    useValue: {
                        generateTokenPair: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
                        refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'at2', refreshToken: 'rt2' }),
                        revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
                    },
                },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
        usersService = module.get<UsersService>(UsersService);
        jwtService = module.get<JwtService>(JwtService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('login', () => {
        it('should login successfully with valid credentials', async () => {
            const loginDto: LoginDto = {
                email: 'test@example.com',
                password: 'password123',
            };

            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
            jest.spyOn(jwtService, 'sign').mockReturnValue('mock-jwt-token');

            const result = await service.login(loginDto);

            expect(result).toEqual({
                access_token: 'at',
                refresh_token: 'rt',
                user: {
                    id: mockUser.id,
                    email: mockUser.email,
                    role: mockUser.role,
                },
            });
            expect(usersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(bcrypt.compare).toHaveBeenCalledWith(loginDto.password, mockUser.password);
        });

        it('should throw UnauthorizedException for invalid email', async () => {
            const loginDto: LoginDto = {
                email: 'nonexistent@example.com',
                password: 'password123',
            };

            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
        });

        it('should throw UnauthorizedException for invalid password', async () => {
            const loginDto: LoginDto = {
                email: 'test@example.com',
                password: 'wrongpassword',
            };

            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

            await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
        });
    });

    describe('register', () => {
        it('should register a new user successfully', async () => {
            const registerDto: RegisterDto = {
                email: 'newuser@example.com',
                name: 'New User',
                password: 'password123',
            };

            const newUser = { ...mockUser, email: registerDto.email, name: registerDto.name, tasks: [] };

            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);
            jest.spyOn(usersService, 'create').mockResolvedValue(newUser);
            jest.spyOn(jwtService, 'sign').mockReturnValue('mock-jwt-token');

            const result = await service.register(registerDto);

            expect(result).toEqual({
                access_token: 'at',
                refresh_token: 'rt',
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    name: newUser.name,
                    role: newUser.role,
                },
            });
            expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
            expect(usersService.create).toHaveBeenCalledWith(registerDto);
        });

        it('should throw ConflictException for existing email', async () => {
            const registerDto: RegisterDto = {
                email: 'existing@example.com',
                name: 'Existing User',
                password: 'password123',
            };

            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUser);

            await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
        });

        it('should throw BadRequestException when user creation fails', async () => {
            const registerDto: RegisterDto = {
                email: 'newuser@example.com',
                name: 'New User',
                password: 'password123',
            };

            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);
            jest.spyOn(usersService, 'create').mockRejectedValue(new Error('Database error'));

            await expect(service.register(registerDto)).rejects.toThrow(BadRequestException);
        });
    });

    describe('validateUser', () => {
        it('should return user when found', async () => {
            jest.spyOn(usersService, 'findOne').mockResolvedValue(mockUser);

            const result = await service.validateUser('1');

            expect(result).toEqual(mockUser);
            expect(usersService.findOne).toHaveBeenCalledWith('1');
        });

        it('should return null when user not found', async () => {
            jest.spyOn(usersService, 'findOne').mockResolvedValue(null as any);

            const result = await service.validateUser('1');

            expect(result).toBeNull();
        });
    });

    describe('validateUserRoles', () => {
        it('should return true when user has required role', async () => {
            const adminUser = { ...mockUser, role: 'admin' };
            jest.spyOn(usersService, 'findOne').mockResolvedValue(adminUser);

            const result = await service.validateUserRoles('1', ['admin']);

            expect(result).toBe(true);
        });

        it('should return false when user does not have required role', async () => {
            jest.spyOn(usersService, 'findOne').mockResolvedValue(mockUser);

            const result = await service.validateUserRoles('1', ['admin']);

            expect(result).toBe(false);
        });

        it('should return false when user not found', async () => {
            jest.spyOn(usersService, 'findOne').mockResolvedValue(null as any);

            const result = await service.validateUserRoles('1', ['admin']);

            expect(result).toBe(false);
        });
    });
});
