import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApprovalsService } from "./approvals.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "@prisma/client";
import { IsOptional, IsString } from "class-validator";

class ActionDto {
  @IsOptional() @IsString() note?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("approvals")
export class ApprovalsController {
  constructor(private svc: ApprovalsService) {}

  @Get("reports")
  getReports(@CurrentUser() user: User, @Query("periodId") periodId?: string) {
    return this.svc.getReports(user, periodId);
  }

  @Get("documents")
  documents(
    @CurrentUser() user: User,
    @Query("type") type: "all" | "km" | "real" = "all",
    @Query("status") status?: string,
    @Query("periodId") periodId?: string,
  ) {
    return this.svc.getDocuments(user, type, status, periodId);
  }

  @Post("reports/:id/advance")
  advance(
    @Param("id") id: string,
    @CurrentUser() user: User,
    @Body() dto: ActionDto,
  ) {
    return this.svc.advanceStage(id, user, dto.note);
  }

  @Post("reports/:id/return")
  return_(
    @Param("id") id: string,
    @CurrentUser() user: User,
    @Body() dto: ActionDto,
  ) {
    return this.svc.returnReport(id, user, dto.note ?? "");
  }
}
