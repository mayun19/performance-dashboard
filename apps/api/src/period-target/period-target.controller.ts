import { Controller, Get, Patch, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { PeriodTargetService } from './period-target.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';

class UpdateTargetDto {
  @IsString() target: string;
  @IsOptional() @IsString() note?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('period-target')
export class PeriodTargetController {
  constructor(private svc: PeriodTargetService) {}

  @Get()
  list(@Query('periodId') periodId?: string) {
    if (!periodId) throw new BadRequestException('periodId diperlukan');
    return this.svc.getForPeriod(periodId);
  }

  // Koreksi KM Sementara per-assignment oleh PIC REN (in-cycle, sebelum KM Final tiba).
  @Patch(':kpiAssignmentId')
  update(
    @CurrentUser() user: User,
    @Param('kpiAssignmentId') kpiAssignmentId: string,
    @Query('periodId') periodId: string,
    @Body() dto: UpdateTargetDto,
  ) {
    if (!periodId) throw new BadRequestException('periodId diperlukan');
    return this.svc.updateTarget(user, periodId, kpiAssignmentId, dto.target, dto.note);
  }
}
