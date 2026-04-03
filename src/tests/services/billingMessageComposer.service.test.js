const test = require('node:test');
const assert = require('node:assert/strict');

const { BillingMessageComposerService } = require('../../api/services/billingMessageComposer.service');

function createBaseInput(referenceDate) {
  return {
    referenceDate,
    notificationLog: {
      type: 'new_invoice',
      recipient_name: 'Mariana Gomes',
      recipient_snapshot: {
        first_name: 'Mariana',
      },
      business_timezone: 'America/Sao_Paulo',
    },
    invoice: {
      _id: 'inv-1',
      description: 'Mensalidade Abril',
      value: 40000,
      dueDate: new Date('2026-04-10T00:00:00.000Z'),
      boleto_url: 'https://example.com/boleto.pdf',
      boleto_barcode: '23793381286008200009012000004702975870000002000',
      boleto_digitable_line: '23793381286008200009012000004702975870000002000',
      gateway: 'cora',
    },
    school: {
      name: 'Colégio A Sementinha',
    },
    config: {
      channels: {
        email: { attachBoletoPdf: true },
        whatsapp: { sendPdfWhenAvailable: true },
      },
    },
  };
}

test('billing message composer uses business timezone for afternoon greeting', () => {
  const service = new BillingMessageComposerService();

  const result = service.compose(createBaseInput(new Date('2026-04-02T18:00:00.000Z')));

  assert.match(result.text, /^Boa tarde, Mariana\./);
});

test('billing message composer uses business timezone for night greeting', () => {
  const service = new BillingMessageComposerService();

  const result = service.compose(createBaseInput(new Date('2026-04-03T01:30:00.000Z')));

  assert.match(result.text, /^Boa noite, Mariana\./);
});

test('billing message composer uses official digitable line and never shows a 44-digit barcode as linha digitavel', () => {
  const service = new BillingMessageComposerService();
  const input = createBaseInput(new Date('2026-04-03T01:30:00.000Z'));

  input.invoice._id = '697ba79923d757cc88e2ffe1';
  input.invoice.description = 'Mensalidade Abril - Maria Clara da Silva Bianchi';
  input.invoice.boleto_barcode = '40391141200000400000000045588698016980452101';
  input.invoice.boleto_digitable_line = '40390000074558869801469804521016114120000040000';

  const result = service.compose(input);

  assert.equal(result.digitable_line, '40390000074558869801469804521016114120000040000');
  assert.match(result.text, /Linha digitável:\n40390000074558869801469804521016114120000040000/);
  assert.doesNotMatch(result.text, /Linha digitável:\n40391141200000400000000045588698016980452101/);
});
