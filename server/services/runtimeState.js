'use strict';

const state = {
  acceptingTraffic: false,
  realtimeReady: false,
  workersReady: false,
  shuttingDown: false,
  startedAt: null,
};

function update(patch) {
  Object.assign(state, patch);
  return snapshot();
}

function snapshot() {
  return { ...state };
}

function reset() {
  state.acceptingTraffic = false;
  state.realtimeReady = false;
  state.workersReady = false;
  state.shuttingDown = false;
  state.startedAt = null;
}

module.exports = { update, snapshot, reset };
