import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { KpiMasterModule } from '../kpi-master/kpi-master.module';
import { PeriodTargetModule } from '../period-target/period-target.module';

@Module({
  imports: [PrismaModule, WhatsappModule, KpiMasterModule, PeriodTargetModule],
  controllers: [AdminController],
})
export class AdminModule {}
