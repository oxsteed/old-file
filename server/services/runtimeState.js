'use strict';

const state = {
  acceptingTraffic: false,
  realtimeReady: false,
  workersReady: false,
  workerMode: 'combined',
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
  state.workerMode = 'combined';
  state.shuttingDown = false;
  state.startedAt = null;
}

module.exports = { update, snapshot, reset };
