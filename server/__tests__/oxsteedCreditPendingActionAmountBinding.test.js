'use strict';

const { resolveCheckerStepupAmountCents } = require('../services/oxsteedCreditPendingActionService');

test('checker step-up binding resolves currency quote source amounts', async () => {
  const queryable = { query: jest.fn() };
  await expect(resolveCheckerStepupAmountCents(queryable, {
    action_type: 'credit_currency_quote',
    payload: { sourceAmountMinorUnits: 2500 },
  })).resolves.toBe(2500);
  expect(queryable.query).not.toHaveBeenCalled();
});

test('checker step-up binding accepts the snake_case quote amount alias', async () => {
  const queryable = { query: jest.fn() };
  await expect(resolveCheckerStepupAmountCents(queryable, {
    action_type: 'credit_currency_quote',
    payload: { source_amount_minor_units: 1750 },
  })).resolves.toBe(1750);
});

test('checker step-up binding resolves dispute compensation amounts', async () => {
  const queryable = { query: jest.fn() };
  await expect(resolveCheckerStepupAmountCents(queryable, {
    action_type: 'credit_dispute_resolve',
    payload: { compensationCents: 3200 },
  })).resolves.toBe(3200);
});
