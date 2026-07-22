import { Module } from '@nestjs/common';
import { PeriodTargetService } from './period-target.service';
import { PeriodTargetController } from './period-target.controller';
import { RestatementService } from './restatement.service';
import { ExecutiveModule } from '../executive/executive.module';
import { OperationalModule } from '../operational/operational.module';

@Module({
  imports: [ExecutiveModule, OperationalModule],
  providers: [PeriodTargetService, RestatementService],
  controllers: [PeriodTargetController],
  exports: [PeriodTargetService, RestatementService],
})
export class PeriodTargetModule {}
