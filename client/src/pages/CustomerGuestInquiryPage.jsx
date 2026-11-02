import MessagingWorkspace from '../components/messaging/MessagingWorkspace';

// Customer-side guest inquiry thread (/messages/guest/:inquiryId). Unlike the
// helper route (/helper/messages/guest/:inquiryId), this renders the customer
// workspace chrome: base path /messages, customer kickers and labels.
export default function CustomerGuestInquiryPage() {
  return <MessagingWorkspace role="customer" />;
}
