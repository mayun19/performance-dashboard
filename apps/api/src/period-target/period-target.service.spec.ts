import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PeriodTargetService } from './period-target.service';
import { RPC_BIDANG } from '../common/workflow-steps';

const picRen = { id: 'user-1', name: 'PIC REN', role: Role.STAFF, unit: 'KP', bidang: RPC_BIDANG } as any;

describe('PeriodTargetService', () => {
  let prisma: any;
  let service: PeriodTargetService;

  beforeEach(() => {
    prisma = {
      periodTarget: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
      period: { findUnique: jest.fn(), findMany: jest.fn() },
      kpiAssignment: { findUnique: jest.fn() },
      revisionLog: { create: jest.fn() },
    };
    service = new PeriodTargetService(prisma);
  });

  it('allows only the KPI planning staff member to update a living target', async () => {
    prisma.periodTarget.findUnique.mockResolvedValue({ id: 'target-1', target: '100', frozen: false });
    prisma.periodTarget.update.mockResolvedValue({ id: 'target-1', target: '120' });

    await expect(service.updateTarget(picRen, 'period-1', 'assignment-1', '120', 'Corrected')).resolves.toEqual({ id: 'target-1', target: '120' });
    expect(prisma.revisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: 'period_target', oldValue: '100', newValue: '120' }),
    }));
  });

  it('rejects a target update from an unauthorised staff member', async () => {
    const otherStaff = { ...picRen, bidang: 'Operasi Manajemen Proyek' };
    await expect(service.updateTarget(otherStaff, 'period-1', 'assignment-1', '120')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('carries forward the most recent frozen target', async () => {
    prisma.periodTarget.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'prior-target', target: '95', frozenTarget: '90', frozen: true });
    prisma.period.findUnique.mockResolvedValue({ id: 'period-2', yearMonth: '2026-02' });
    prisma.period.findMany.mockResolvedValue([{ id: 'period-1' }]);
    prisma.periodTarget.create.mockResolvedValue({ id: 'target-2', target: '90', source: 'carried' });

    await expect(service.getOrSeed('period-2', 'assignment-1')).resolves.toMatchObject({ target: '90', source: 'carried' });
    expect(prisma.periodTarget.create).toHaveBeenCalledWith({ data: expect.objectContaining({ target: '90', source: 'carried' }) });
  });

  it('fails clearly when creating a target for an unknown period', async () => {
    prisma.periodTarget.findUnique.mockResolvedValue(null);
    prisma.period.findUnique.mockResolvedValue(null);
    await expect(service.getOrSeed('missing', 'assignment-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
