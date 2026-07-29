import {
  Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards,
} from '@nestjs/common';
import { InputKontrakService } from './input-kontrak.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { IsArray, IsString, IsOptional, IsIn } from 'class-validator';

class SaveDto {
  @IsOptional() @IsString() id?: string;
  @IsString() unitCode: string;
  @IsString() bidang: string;
  @IsString() holder: string;
  @IsArray() kpiItems: Record<string, unknown>[];
  @IsOptional() @IsIn(['draft', 'final']) kmType?: string;
}

class ReviewDto {
  @IsIn(['approve', 'reject']) action: 'approve' | 'reject';
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsIn(['konseptor', 'previous']) returnTo?: 'konseptor' | 'previous';
}

class UpdateKpiItemsDto {
  @IsArray() kpiItems: object[];
}

class SubmitDto {
  @IsArray() @IsString({ each: true }) checkerIds: string[];
  @IsArray() @IsString({ each: true }) approverIds: string[];
}

class BundleReviewDto {
  @IsIn(['approve', 'reject']) action: 'approve' | 'reject';
  @IsIn(['KP', 'UPMK']) scope: 'KP' | 'UPMK';
  @IsString() note: string;
  @IsOptional() @IsString() year?: string;
  @IsOptional() @IsIn(['draft', 'final']) kmType?: string;
}

class BulkApproveDto {
  @IsString() note: string;
}

@UseGuards(JwtAuthGuard)
@Controller('input-kontrak')
export class InputKontrakController {
  constructor(private svc: InputKontrakService) {}

  @Get()
  list(@Query('unitCode') unitCode?: string, @Query('periodId') periodId?: string, @Query('kmType') kmType?: string) {
    return this.svc.getList(unitCode, periodId, kmType);
  }

  @Get('review/list')
  reviewList(@CurrentUser() user: User) {
    return this.svc.getReviewList(user);
  }

  @Post('review/bulk-approve')
  bulkApprove(@CurrentUser() user: User, @Body() dto: BulkApproveDto) {
    return this.svc.bulkApprove(user, dto.note);
  }

  @Get('reviewer-candidates')
  reviewerCandidates() {
    return this.svc.getReviewerCandidates();
  }

  @Get('approved')
  approved(@Query('unitCode') unitCode?: string, @Query('year') year?: string, @Query('kmType') kmType?: string) {
    return this.svc.getApproved(unitCode, year, kmType);
  }

  // Acuan Input Realisasi: KM Sementara begitu disubmit (paralel dgn alur review-nya sendiri).
  @Get('for-realisasi')
  forRealisasi(@Query('unitCode') unitCode?: string, @Query('year') year?: string, @Query('kmType') kmType?: string) {
    return this.svc.getForRealisasi(unitCode, year, kmType);
  }

  @Get('bundle')
  bundle(@Query('scope') scope: 'KP' | 'UPMK' = 'KP', @Query('year') year?: string, @Query('kmType') kmType: string = 'draft') {
    return this.svc.getBundle(scope, year, kmType);
  }

  @Post('bundle/review')
  reviewBundle(@CurrentUser() user: User, @Body() dto: BundleReviewDto) {
    return this.svc.reviewBundle(user, dto.scope, dto.action, dto.note, dto.year, dto.kmType ?? 'draft');
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Post('save')
  save(@CurrentUser() user: User, @Body() dto: SaveDto) {
    return this.svc.save(user, dto.id, dto.unitCode, dto.bidang, dto.holder, dto.kpiItems, dto.kmType ?? 'draft');
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.svc.submit(user, id, dto.checkerIds, dto.approverIds);
  }

  @Patch(':id/values')
  updateKpiItems(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateKpiItemsDto) {
    return this.svc.updateKpiItems(user, id, dto.kpiItems);
  }

  @Post(':id/review')
  review(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.svc.review(user, id, dto.action, dto.note, dto.returnTo);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }
}
