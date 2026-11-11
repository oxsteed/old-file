'use strict';

function getAppleAppAssociation({ teamId = process.env.APPLE_TEAM_ID } = {}) {
  const appleTeamId = String(teamId || 'ZBRGSDRRU7').trim() || 'ZBRGSDRRU7';
  return {
    applinks: {
      apps: [],
      details: [{ appID: `${appleTeamId}.com.oxsteed.app`, paths: ['*'] }],
    },
    webcredentials: { apps: [`${appleTeamId}.com.oxsteed.app`] },
  };
}

module.exports = { getAppleAppAssociation };
