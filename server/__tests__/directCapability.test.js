'use strict';

const { deriveServiceCapability } = require('../services/directCapability');

describe('deriveServiceCapability', () => {
  const liveParent = { lifecycle_status: 'live', is_active: true };

  test('Live + operational + bookable preference + open slots ⇒ Bookable', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: true,
      is_bookable: true,
      is_active: true,
    }, liveParent, {
      slotsAvailable: true,
      freeCapacityInHorizon: true,
      assigneePoolSize: 1,
    });
    expect(result).toEqual(expect.objectContaining({
      visible: true,
      requestable: true,
      bookable: true,
    }));
  });

  test('auto-falls to Requestable when capacity exhausted', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: true,
      is_bookable: true,
      is_active: true,
    }, liveParent, {
      slotsAvailable: false,
      capacityExhausted: true,
      assigneePoolSize: 1,
    });
    expect(result.visible).toBe(true);
    expect(result.requestable).toBe(true);
    expect(result.bookable).toBe(false);
    expect(result.capabilityReasons).toContain('capacity_exhausted');
  });

  test('auto-falls when pool empty', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: true,
      is_bookable: true,
      is_active: true,
    }, liveParent, {
      slotsAvailable: false,
      assigneePoolSize: 0,
    });
    expect(result.requestable).toBe(true);
    expect(result.bookable).toBe(false);
    expect(result.capabilityReasons).toContain('bookable_without_pool');
  });

  test('paused is Visible but not Requestable/Bookable', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'paused',
      is_operationally_available: true,
      is_bookable: true,
      is_active: true,
    }, liveParent, {
      slotsAvailable: true,
      assigneePoolSize: 2,
    });
    expect(result.visible).toBe(true);
    expect(result.requestable).toBe(false);
    expect(result.bookable).toBe(false);
  });

  test('operational off clears Requestable and Bookable while Live stays Visible', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: false,
      is_bookable: true,
      is_active: true,
    }, liveParent, {
      slotsAvailable: true,
      assigneePoolSize: 1,
    });
    expect(result.visible).toBe(true);
    expect(result.requestable).toBe(false);
    expect(result.bookable).toBe(false);
    expect(result.capabilityReasons).toContain('not_operational');
  });

  test('Bookable preference off leaves Requestable intact', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: true,
      is_bookable: false,
      is_active: true,
    }, liveParent, {
      slotsAvailable: true,
      assigneePoolSize: 1,
    });
    expect(result.requestable).toBe(true);
    expect(result.bookable).toBe(false);
  });

  test('tools are not Bookable in v1', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: true,
      is_bookable: true,
      is_active: true,
    }, liveParent, {
      entity: 'tool',
      slotsAvailable: true,
      assigneePoolSize: 1,
    });
    expect(result.requestable).toBe(true);
    expect(result.bookable).toBe(false);
  });

  test('invariants Bookable ⇒ Requestable ⇒ Visible', () => {
    const result = deriveServiceCapability({
      lifecycle_status: 'live',
      is_operationally_available: true,
      is_bookable: true,
      is_active: true,
    }, liveParent, { slotsAvailable: true, assigneePoolSize: 1 });
    expect(result.bookable).toBe(true);
    expect(result.requestable).toBe(true);
    expect(result.visible).toBe(true);
  });
});
