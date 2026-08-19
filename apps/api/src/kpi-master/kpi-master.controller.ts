import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { KpiMasterService } from "./kpi-master.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "@prisma/client";
import {
  IsArray,
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  ValidateNested,
  IsObject,
} from "class-validator";
import { Type } from "class-transformer";

class AssignmentDto {
  @IsString() unitCode!: string;
  @IsString() bidang!: string;
  @IsOptional() @IsString() holder?: string;
  @IsOptional() @IsString() target?: string;
  @IsOptional() @IsString() target2?: string;
  @IsOptional() @IsNumber() persenAgregasi?: number;
  // reviewerSlots (A+B) divalidasi/normalisasi mendalam di service (sanitizeReviewerSlots);
  // di sini cukup terima objek opsional (atau null).
  @IsOptional() @IsObject() reviewerSlots?: Record<string, unknown> | null;
  // Override target sub-indikator (KPI Komposit) — divalidasi/dinormalisasi di service
  // (sanitizeSubIndicatorTargets); di sini cukup terima array opsional.
  @IsOptional() @IsArray() subIndicatorTargets?: Array<{
    target?: string;
    target2?: string;
  }>;
}

class SubIndicatorDto {
  @IsString() nama!: string;
  @IsOptional() @IsString() satuan?: string;
  @IsString() bobot!: string;
  @IsString() target!: string;
  @IsOptional() @IsString() target2?: string;
  @IsOptional() @IsString() formula?: string;
  @IsOptional() @IsIn(["positive", "negative"]) polaritas?: string;
}

class SaveMasterDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsIn(["draft", "final"]) kmType?: string;
  @IsString() indikator!: string;
  @IsOptional() @IsString() formula?: string;
  @IsOptional() @IsString() satuan?: string;
  @IsOptional() @IsString() bobotKm?: string;
  @IsOptional() @IsString() targetParent?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments!: AssignmentDto[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  defaultCheckerIds?: string[];
  @IsOptional() @IsString() defaultApproverId?: string;
  @IsOptional() @IsIn(["weighted", "sum"]) aggregationMethod?: string;
  // Sub-indikator (opt-in, generik) — non-kosong menandai KPI ini "komposit".
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubIndicatorDto)
  subIndicators?: SubIndicatorDto[];
  // Polaritas indikator induk non-komposit ('positive'|'negative') — lihat catatan di service.
  @IsOptional() @IsIn(["positive", "negative"]) polaritas?: string;
}

class ConsolidationReviewDto {
  @IsString() kpiMasterId!: string;
  @IsIn(["approve", "reject"]) action!: "approve" | "reject";
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() periodId?: string;
}

class OtherAssignmentPersenDto {
  @IsString() id!: string;
  @IsOptional() @IsString() holder?: string;
  @IsOptional() @IsString() target?: string;
  @IsOptional() @IsString() target2?: string;
  @IsOptional() @IsNumber() persenAgregasi?: number;
}

// Patch sempit utk reviseRejectedAssignment() — lihat catatan pembatasan field di service.
class ReviseRejectedAssignmentDto {
  // Field assignment UTAMA (holder/target/target2/persenAgregasi) 
  @IsOptional() @IsString() holder?: string;
  @IsOptional() @IsString() target?: string;
  @IsOptional() @IsString() target2?: string;
  @IsOptional() @IsNumber() persenAgregasi?: number;

  // Field definisi KpiMaster (SHARED lintas semua assignment KPI ini)
  @IsOptional() @IsString() indikator?: string;
  @IsOptional() @IsString() formula?: string;
  @IsOptional() @IsString() satuan?: string;
  @IsOptional() @IsString() bobotKm?: string;
  @IsOptional() @IsString() targetParent?: string;
  @IsOptional() @IsIn(["positive", "negative"]) polaritas?:
    | "positive"
    | "negative";
  @IsOptional() @IsIn(["weighted", "sum"]) aggregationMethod?:
    | "weighted"
    | "sum";
  @IsOptional() @IsIn(["draft", "final"]) kmType?: string;

  // Assignment lain (unit/bidang lain) pada KPI Master yang sama, direvisi sekaligus -----
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtherAssignmentPersenDto)
  otherAssignments?: OtherAssignmentPersenDto[];
}

@UseGuards(JwtAuthGuard)
@Controller("kpi-master")
export class KpiMasterController {
  constructor(private svc: KpiMasterService) {}

  @Get()
  list(
    @Query("year") year?: string,
    @Query("kmType") kmType?: string,
    @Query("includeSuperseded") includeSuperseded?: string,
    @Query("currentPage") currentPage?: string,
    @Query("perPage") perPage?: string,
  ) {
    return this.svc.list(
      year,
      kmType,
      includeSuperseded === "true",
      currentPage ? parseInt(currentPage) : undefined,
      perPage ? parseInt(perPage) : undefined,
    );
  }

  @Get("review/per-kpi")
  getPerKpiReview(
    @CurrentUser() user: User,
    @Query("periodId") periodId?: string,
  ) {
    return this.svc.getPerKpiReview(user, periodId);
  }

  @Post("review/consolidation")
  reviewConsolidation(
    @CurrentUser() user: User,
    @Body() dto: ConsolidationReviewDto,
  ) {
    return this.svc.reviewConsolidation(
      user,
      dto.kpiMasterId,
      dto.action,
      dto.note,
      dto.periodId,
    );
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.svc.getById(id);
  }

  @Get(":id/rollup")
  getRollup(@Param("id") id: string, @Query("periodId") periodId?: string) {
    return this.svc.getRollup(id, periodId);
  }

  @Get("defaults-for-km/:kmId")
  getDefaultsForKm(@Param("kmId") kmId: string) {
    return this.svc.getDefaultsForKm(kmId);
  }

  @Post("save")
  save(@CurrentUser() user: User, @Body() dto: SaveMasterDto) {
    return this.svc.save(user, dto);
  }

  // Revisi cepat 1 assignment yang dokumen KM-nya baru saja ditolak — lihat catatan
  // pembeda dgn save() di KpiMasterService.reviseRejectedAssignment().
  @Post("assignment/:assignmentId/revise-rejected")
  reviseRejectedAssignment(
    @CurrentUser() user: User,
    @Param("assignmentId") assignmentId: string,
    @Body() dto: ReviseRejectedAssignmentDto,
  ) {
    return this.svc.reviseRejectedAssignment(user, assignmentId, dto);
  }

  @Delete(":id")
  delete(@CurrentUser() user: User, @Param("id") id: string) {
    return this.svc.delete(user, id);
  }
}
