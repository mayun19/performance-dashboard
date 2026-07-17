import { Module } from '@nestjs/common';
import { KpiMasterService } from './kpi-master.service';
import { KpiMasterController } from './kpi-master.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [KpiMasterService],
  controllers: [KpiMasterController],
  exports: [KpiMasterService],
})
export class KpiMasterModule {}
