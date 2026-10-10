import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

function makeService(invoice: Record<string, unknown>) {
  const create = jest.fn().mockResolvedValue({ id: 'pay1' });
  const markPaid = jest.fn().mockResolvedValue(undefined);
  const platformPrisma = {
    client: {
      invoice: { findUniqueOrThrow: jest.fn().mockResolvedValue(invoice) },
      payment: { create },
    },
  };
  const service = new PaymentsService(
    platformPrisma as never,
    { markPaid } as never,
    { record: jest.fn() } as never,
  );
  return { service, create, markPaid };
}

const baseInvoice = { id: 'inv1', tenantId: 't1', subscriptionId: 's1', status: 'ISSUED', totalCents: 10_000, currency: 'INR', invoiceNumber: 'INV-1' };

describe('PaymentsService.recordPayment amount integrity', () => {
  it('rejects an amount greater than the invoice total', async () => {
    const { service, create } = makeService(baseInvoice);
    await expect(
      service.recordPayment('inv1', { method: 'CARD', status: 'PENDING', amountCents: 20_000 } as never, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a SUCCEEDED payment that does not settle the full invoice total', async () => {
    const { service, create, markPaid } = makeService(baseInvoice);
    await expect(
      service.recordPayment('inv1', { method: 'CARD', status: 'SUCCEEDED', amountCents: 1 } as never, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('records a full SUCCEEDED payment and settles the invoice', async () => {
    const { service, create, markPaid } = makeService(baseInvoice);
    await service.recordPayment('inv1', { method: 'CARD', status: 'SUCCEEDED', amountCents: 10_000 } as never, 'admin');
    expect(create).toHaveBeenCalledTimes(1);
    expect(markPaid).toHaveBeenCalledWith('inv1', 'admin');
  });

  it('defaults the amount to the invoice total', async () => {
    const { service, create } = makeService(baseInvoice);
    await service.recordPayment('inv1', { method: 'CARD', status: 'SUCCEEDED' } as never, 'admin');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amountCents: 10_000 }) }));
  });
});
