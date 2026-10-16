import MessagingWorkspace from '../components/messaging/MessagingWorkspace';
import SopGuideButton from '../sop/components/SopGuideButton';
import './MessagesDynamic.css';

export default function MessagesPage() {
  return (
    <>
      <SopGuideButton />
      <MessagingWorkspace role="customer" />
    </>
  );
}
