import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFiles, Res } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InputRealisasiService } from './input-realisasi.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { IsObject, IsString, IsOptional, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SubmitDto {
  @IsString() unitCode: string;
  @IsString() bidang: string;
  @IsObject() values: Record<string, unknown>;
  @IsArray() @IsString({ each: true }) checkerIds: string[];
  @IsString() approverId: string;
  @IsOptional() @IsString() periodId?: string;
}

class ReviewDto {
  @IsIn(['approve', 'reject']) action: 'approve' | 'reject';
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsIn(['konseptor', 'previous', 'target']) returnTo?: 'konseptor' | 'previous' | 'target';
}

class TargetFixItemDto {
  @IsString() kpiAssignmentId: string;
  @IsString() target: string;
}

class TargetFixDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => TargetFixItemDto) updates: TargetFixItemDto[];
  @IsString() note: string;
}

class UpdateValuesDto {
  @IsObject() values: Record<string, unknown>;
  @IsOptional() @IsString() note?: string;
}

class BundleReviewDto {
  @IsIn(['approve', 'reject']) action: 'approve' | 'reject';
  @IsString() note: string;
  @IsOptional() @IsString() periodId?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('input-realisasi')
export class InputRealisasiController {
  constructor(private svc: InputRealisasiService) {}

  @Get('history')
  history(@Query('unitCode') unitCode?: string, @Query('periodId') periodId?: string) {
    return this.svc.getHistory(unitCode, periodId);
  }

  @Get('review/list')
  reviewList(@CurrentUser() user: User) {
    return this.svc.getReviewList(user);
  }

  @Get('reviewer-candidates')
  reviewerCandidates() {
    return this.svc.getReviewerCandidates();
  }

  // Bundle periode (deklarasikan sebelum rute :id agar tidak tertangkap param)
  @Get('bundle')
  bundle(@Query('periodId') periodId?: string) {
    return this.svc.getBundle(periodId);
  }

  @Post('bundle/review')
  reviewBundle(@CurrentUser() user: User, @Body() dto: BundleReviewDto) {
    return this.svc.reviewBundle(user, dto.action, dto.note, dto.periodId);
  }

  @Put('submit')
  submit(@CurrentUser() user: User, @Body() dto: SubmitDto) {
    return this.svc.submit(user, dto.unitCode, dto.bidang, dto.values, dto.checkerIds, dto.approverId, dto.periodId);
  }

  @Patch(':id/values')
  updateValues(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateValuesDto) {
    return this.svc.updateValues(user, id, dto.values, dto.note);
  }

  // Fase 5: timeline riwayat revisi gabungan (koreksi nilai realisasi + koreksi target KM Sementara).
  @Get(':id/revisions')
  getRevisionHistory(@Param('id') id: string) {
    return this.svc.getRevisionHistory(id);
  }

  @Post(':id/review')
  review(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.svc.review(user, id, dto.action, dto.note, dto.returnTo);
  }

  // PIC REN menyelesaikan koreksi KM Sementara untuk package berstatus 'target_fix'.
  @Post(':id/resolve-target-fix')
  resolveTargetFix(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: TargetFixDto) {
    return this.svc.resolveTargetFix(user, id, dto.updates, dto.note);
  }

  // ===== Evidence (lampiran) =====
  @Post(':id/evidence')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  addEvidence(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; size: number; mimetype: string }>,
  ) {
    return this.svc.addEvidence(user, id, files);
  }

  @Get(':id/evidence/:fileId')
  async downloadEvidence(@Param('id') id: string, @Param('fileId') fileId: string, @Res() res: Response) {
    const f = await this.svc.getEvidenceFile(id, fileId);
    return res.download(f.path, f.name);
  }

  @Delete(':id/evidence/:fileId')
  deleteEvidence(@CurrentUser() user: User, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.svc.deleteEvidence(user, id, fileId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }
}
