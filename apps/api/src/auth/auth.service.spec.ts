import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));
const bcrypt = require('bcryptjs') as { compare: jest.Mock };

describe('AuthService', () => {
  let prisma: any;
  let jwt: { sign: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() }, refreshToken: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() } };
    jwt = { sign: jest.fn().mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token') };
    service = new AuthService(prisma, jwt as any, { get: jest.fn((_key: string, fallback: string) => fallback) } as any);
  });

  it('rejects an unknown or inactive user before checking a password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('missing@example.com', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('issues and stores a rotating refresh token after a valid login', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'staff@example.com', name: 'Staff', role: Role.STAFF, passwordHash: 'hash', isActive: true });
    bcrypt.compare.mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({});

    const result = await service.login('staff@example.com', 'password');
    expect(result).toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token', user: { id: 'user-1' } });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', token: 'refresh-token' }) }));
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an expired refresh token and removes it', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({ id: 'token-1', expiresAt: new Date(Date.now() - 1), user: {} });
    await expect(service.refresh('expired-token')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { token: 'expired-token' } });
  });
});
