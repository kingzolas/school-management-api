const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractCoraBankSlipFields,
  normalizeBarcode,
  normalizeDigitableLine,
} = require('../../api/utils/boleto.util');

test('extractCoraBankSlipFields maps barcode and digitable line from Cora bank_slip payload', () => {
  const fields = extractCoraBankSlipFields({
    payment_options: {
      bank_slip: {
        barcode: '40391141200000400000000045588698016980452101',
        digitable: '40390.00007 45588.698014 69804.521016 1 14120000040000',
        url: 'https://example.com/boleto.pdf',
      },
    },
  });

  assert.equal(fields.url, 'https://example.com/boleto.pdf');
  assert.equal(fields.barcode, '40391141200000400000000045588698016980452101');
  assert.equal(fields.digitableLine, '40390000074558869801469804521016114120000040000');
});

test('normalizeDigitableLine accepts only 47 digits and normalizeBarcode accepts only 44 digits', () => {
  assert.equal(normalizeDigitableLine('40390.00007 45588.698014 69804.521016 1 14120000040000'), '40390000074558869801469804521016114120000040000');
  assert.equal(normalizeDigitableLine('40391141200000400000000045588698016980452101'), null);
  assert.equal(normalizeBarcode('40391141200000400000000045588698016980452101'), '40391141200000400000000045588698016980452101');
  assert.equal(normalizeBarcode('40390.00007 45588.698014 69804.521016 1 14120000040000'), null);
});
