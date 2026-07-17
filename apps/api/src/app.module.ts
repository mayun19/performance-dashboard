import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MetaModule } from './meta/meta.module';
import { ExecutiveModule } from './executive/executive.module';
import { FinancialModule } from './financial/financial.module';
import { OperationalModule } from './operational/operational.module';
import { StrategicModule } from './strategic/strategic.module';
import { HumanCapitalModule } from './human-capital/human-capital.module';
import { RiskModule } from './risk/risk.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { WorkflowKmModule } from './workflow-km/workflow-km.module';
import { InputRealisasiModule } from './input-realisasi/input-realisasi.module';
import { InputKontrakModule } from './input-kontrak/input-kontrak.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { KpiModule } from './kpi/kpi.module';
import { ProsesBisnisModule } from './proses-bisnis/proses-bisnis.module';
import { OrganisasiModule } from './organisasi/organisasi.module';
import { GcgEsgModule } from './gcg-esg/gcg-esg.module';
import { PetaModule } from './peta/peta.module';
import { KinerjaModule } from './kinerja/kinerja.module';
import { AdminModule } from './admin/admin.module';
import { KpiMasterModule } from './kpi-master/kpi-master.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule.register({ isGlobal: true, ttl: 300_000 }),
    PrismaModule,
    AuthModule,
    MetaModule,
    ExecutiveModule,
    FinancialModule,
    OperationalModule,
    StrategicModule,
    HumanCapitalModule,
    RiskModule,
    ApprovalsModule,
    WorkflowKmModule,
    InputRealisasiModule,
    InputKontrakModule,
    NotificationsModule,
    AuditModule,
    KpiModule,
    ProsesBisnisModule,
    OrganisasiModule,
    GcgEsgModule,
    PetaModule,
    KinerjaModule,
    AdminModule,
    KpiMasterModule,
  ],
})
export class AppModule {}
