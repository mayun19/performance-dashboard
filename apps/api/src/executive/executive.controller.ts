import { Controller, Get, Post, Query, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ExecutiveService } from './executive.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, Role } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('executive')
export class ExecutiveController {
  constructor(private svc: ExecutiveService) {}

  @Get('summary')
  summary(@Query('periodId') periodId?: string, @Query('phase') phase?: 'sementara' | 'final') {
    return this.svc.getSummary(periodId, phase === 'sementara' || phase === 'final' ? phase : undefined);
  }

  @Post('refresh')
  async refresh(@CurrentUser() user: User, @Query('periodId') periodId?: string) {
    if (user.role !== Role.SUPERADMIN && user.role !== Role.DEVELOPER && user.role !== Role.GM) {
      throw new ForbiddenException('Tidak diizinkan');
    }
    if (!periodId) throw new BadRequestException('periodId diperlukan');
    await this.svc.refreshFromRealisasi(periodId);
    return { message: 'Executive snapshot diperbarui', periodId };
  }
}
