import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getFillWindowStatus } from '../common/period-window';

@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService) {}

  async getActivePeriod() {
    const period = await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) return null;
    return { ...period, fillWindow: getFillWindowStatus(period.yearMonth, period.windowOverride) };
  }

  async getPeriods() {
    const periods = await this.prisma.period.findMany({ orderBy: { yearMonth: 'desc' } });
    return periods.map((p) => ({ ...p, fillWindow: getFillWindowStatus(p.yearMonth, p.windowOverride) }));
  }

  async getRoleVariants() {
    return this.prisma.roleVariant.findMany({
      orderBy: [{ tier: 'asc' }, { label: 'asc' }],
    });
  }
}
