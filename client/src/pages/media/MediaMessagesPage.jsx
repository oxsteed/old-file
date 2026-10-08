import React from 'react';
import MessagingWorkspace from '../../components/messaging/MessagingWorkspace';

export default function MediaMessagesPage() {
  return (
    <div className="media-messages-page">
      <MessagingWorkspace role="customer" embedded />
    </div>
  );
}
