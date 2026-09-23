import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { User, RoleVariant } from '@prisma/client';

type UserWithVariant = User & { roleVariant?: RoleVariant | null };

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roleVariant: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { include: { roleVariant: true } } },
    });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await this.prisma.refreshToken.delete({ where: { token: refreshToken } });
      throw new ForbiddenException('Refresh token expired or invalid');
    }
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string) {
    if (refreshToken) {
      await this.prisma.refreshToken
        .delete({ where: { token: refreshToken } })
        .catch(() => null);
    }
  }

  private async issueTokens(user: UserWithVariant) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET', 'change_me_access');
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET', 'change_me_refresh');

    const accessToken = this.jwt.sign(payload, { secret: accessSecret, expiresIn: '15m' });
    const refreshToken = this.jwt.sign(payload, { secret: refreshSecret, expiresIn: '7d' });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt },
    });

    return { accessToken, refreshToken, user: this.sanitize(user) };
  }

  sanitize(user: UserWithVariant) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
