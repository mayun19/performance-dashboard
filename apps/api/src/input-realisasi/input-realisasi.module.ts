import { Module } from '@nestjs/common';
import { InputRealisasiService } from './input-realisasi.service';
import { InputRealisasiController } from './input-realisasi.controller';
import { ExecutiveModule } from '../executive/executive.module';
import { OperationalModule } from '../operational/operational.module';
import { PeriodTargetModule } from '../period-target/period-target.module';

@Module({
  imports: [ExecutiveModule, OperationalModule, PeriodTargetModule],
  providers: [InputRealisasiService],
  controllers: [InputRealisasiController],
})
export class InputRealisasiModule {}
