import React from 'react';
import { Navigate } from 'react-router-dom';
import { LAUNCH_VISIBILITY } from '../../utils/launchScope';

export default function MediaLaunchGate({ children }) {
  if (!LAUNCH_VISIBILITY.oxsteedMedia) {
    return <Navigate to="/" replace />;
  }
  return children;
}
