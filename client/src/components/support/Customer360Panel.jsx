import { Briefcase, CreditCard, FileImage, History, Mail, MessageSquare, ShoppingBag, UserRound, WalletCards } from 'lucide-react';

function formatWhen(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatMoney(cents, currency = 'USD') {
  const amount = Number(cents || 0);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
}

function isPreviewableImage(item) {
  const name = String(item?.attachment_name || '').toLowerCase();
  return /\.(?:png|jpe?g|gif|webp)$/i.test(name);
}

function Count({ label, value, icon: Icon }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><Icon size={14} className="text-orange-300" /><div className="mt-2 text-lg font-semibold text-white">{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>;
}

export default function Customer360Panel({ data, loading, lifecycle = [], lifecycleLoading = false }) {
  if (loading) return <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-400">Loading customer context…</section>;
  if (!data) return null;
  const profile = data.profile || {};
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Customer';
  const orders = [...(data.orders?.marketplace || []), ...(data.orders?.food || [])];
  const supportConversations = data.supportConversations || [];
  const conversationMessages = data.conversationMessages || [];
  const attachments = data.attachments || [];
  const assignmentHistory = data.assignmentHistory || [];
  const credit = data.credit || { accounts: [], transactions: [], holds: [], disputes: [], summary: {} };
  const messagesByConversation = conversationMessages.reduce((groups, message) => {
    const messages = groups.get(message.conversation_id) || [];
    messages.push(message);
    groups.set(message.conversation_id, messages);
    return groups;
  }, new Map());

  return (
    <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4" aria-labelledby="customer-360-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-200"><UserRound size={16} /> Customer 360</div>
          <h4 id="customer-360-title" className="mt-1 text-base font-semibold text-white">{name}</h4>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400"><span className="inline-flex items-center gap-1"><Mail size={12} /> {profile.email || 'No email'}</span>{profile.phone && <span>{profile.phone}</span>}{profile.preferred_language && <span>Language: {profile.preferred_language}</span>}</div>
        </div>
        <span className="rounded-full border border-blue-400/25 px-2.5 py-1 text-[11px] text-blue-200">Staff context only</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
        <Count label="Conversations" value={data.summary?.conversations || 0} icon={MessageSquare} />
        <Count label="Jobs" value={data.summary?.jobs || 0} icon={Briefcase} />
        <Count label="Payments" value={data.summary?.payments || 0} icon={CreditCard} />
        <Count label="Orders" value={data.summary?.orders || 0} icon={ShoppingBag} />
        <Count label="Attachments" value={data.summary?.attachments || 0} icon={FileImage} />
        <Count label="Internal notes" value={data.summary?.internalNotes || 0} icon={History} />
        <Count label="Credit holds" value={credit.summary?.activeHoldCount || 0} icon={WalletCards} />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Conversation history</summary>
          <div className="mt-3 space-y-2">
            {supportConversations.slice(0, 8).map((conversation) => (
              <div key={conversation.id} className="rounded-lg bg-slate-900 p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-200">{conversation.subject || 'Support conversation'}</div>
                  {conversation.review_rating != null && <span className="text-amber-200">{conversation.review_rating}/5</span>}
                </div>
                <div className="mt-1 text-slate-500">{conversation.status || 'open'} · {conversation.agent_name || 'Unassigned'} · {conversation.channel || 'web_chat'} · {formatWhen(conversation.updated_at || conversation.created_at)}</div>
                {(messagesByConversation.get(conversation.id) || []).slice(0, 4).map((message) => (
                  <div key={message.id} className="mt-2 border-l-2 border-slate-700 pl-2 text-slate-400">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{message.is_agent ? (message.is_ai ? 'AI support' : message.sender_name || 'Agent') : 'Customer'} · {formatWhen(message.created_at)}</div>
                    <div className="mt-0.5 whitespace-pre-wrap">{message.content || `[${message.message_type || 'message'}]`}</div>
                  </div>
                ))}
              </div>
            ))}
            {!supportConversations.length && <p className="text-xs text-slate-500">No prior conversations found.</p>}
          </div>
        </details>
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Email history</summary>
          <div className="mt-3 space-y-2">
            {(data.emailHistory || []).slice(0, 10).map((email) => (
              <div key={email.id} className="rounded-lg bg-slate-900 p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-200">{email.subject || 'Support email'}</div>
                  <span className={email.status === 'sent' ? 'text-emerald-300' : email.status === 'failed' ? 'text-red-300' : 'text-amber-300'}>{email.status}</span>
                </div>
                <div className="mt-1 text-slate-500">{email.kind || 'support'} · {email.recipient} · {formatWhen(email.sent_at || email.created_at)}</div>
                {Number(email.attempts || 0) > 0 && <div className="mt-1 text-slate-500">Attempts: {email.attempts}</div>}
                {email.last_error && <div className="mt-1 text-red-300/80">{email.last_error}</div>}
              </div>
            ))}
            {!data.emailHistory?.length && <p className="text-xs text-slate-500">No support email history found.</p>}
          </div>
        </details>
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Recent jobs</summary>
          <div className="mt-3 space-y-2">{(data.jobs || []).slice(0, 5).map((job) => <div key={job.id} className="rounded-lg bg-slate-900 p-2 text-xs"><div className="font-semibold text-slate-200">{job.title}</div><div className="mt-1 text-slate-500">{job.status} · {formatWhen(job.updated_at || job.created_at)}</div></div>)}{!data.jobs?.length && <p className="text-xs text-slate-500">No jobs found.</p>}</div>
        </details>
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Orders and payments</summary>
          <div className="mt-3 space-y-2">{[...(data.payments || []).slice(0, 3).map((payment) => ({ ...payment, kind: 'Payment', detail: payment.status })), ...orders.slice(0, 3).map((order) => ({ ...order, kind: 'Order', detail: order.status }))].map((item, index) => <div key={`${item.kind}-${item.id}-${index}`} className="rounded-lg bg-slate-900 p-2 text-xs"><div className="font-semibold text-slate-200">{item.kind} {item.id}</div><div className="mt-1 text-slate-500">{item.detail} · {formatWhen(item.updated_at || item.created_at)}</div></div>)}{!data.payments?.length && !orders.length && <p className="text-xs text-slate-500">No orders or payments found.</p>}</div>
        </details>
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Prior agents and internal notes</summary>
          <div className="mt-3 space-y-2">
            {(data.priorAgents || []).map((agent) => <div key={agent.id} className="text-xs text-slate-300">{agent.name}</div>)}
            {assignmentHistory.slice(0, 8).map((assignment) => <div key={assignment.id} className="rounded-lg bg-slate-900 p-2 text-xs"><div className="font-semibold text-slate-200">{assignment.agent_name}</div><div className="mt-1 text-slate-500">{assignment.assignment_type || 'assignment'} · {assignment.status || 'active'} · {formatWhen(assignment.claimed_at)}</div></div>)}
            {(data.internalNotes || []).slice(0, 4).map((note) => <div key={note.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100"><div className="font-semibold">{note.subject || 'Support note'}</div><div className="mt-1 whitespace-pre-wrap">{note.content}</div><div className="mt-1 text-[10px] text-amber-200/60">{note.author_name} · {formatWhen(note.created_at)}</div></div>)}
            {!data.priorAgents?.length && !assignmentHistory.length && !data.internalNotes?.length && <p className="text-xs text-slate-500">No prior agents or internal notes.</p>}
          </div>
        </details>
        <details className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-emerald-100">OxSteed Credit</summary>
          <div className="mt-3 space-y-3">
            {credit.accounts.length > 0 ? credit.accounts.map((account) => (
              <div key={account.id} className="rounded-lg border border-emerald-500/20 bg-slate-900 p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{account.currencyCode || 'USD'} wallet</span>
                  <span className={account.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}>{account.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <span className="text-slate-500">Balance <strong className="block text-slate-200">{formatMoney(account.balanceCents, account.currencyCode)}</strong></span>
                  <span className="text-slate-500">Reserved <strong className="block text-amber-200">{formatMoney(account.reservedCents, account.currencyCode)}</strong></span>
                  <span className="text-slate-500">Spendable <strong className="block text-emerald-200">{formatMoney(account.availableCents, account.currencyCode)}</strong></span>
                </div>
              </div>
            )) : <p className="text-xs text-slate-500">No OxSteed Credit account found.</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span>{credit.summary?.transactionCount || 0} transactions</span>
              <span>{credit.summary?.activeHoldCount || 0} active holds</span>
              <span>{credit.summary?.openDisputeCount || 0} open disputes</span>
            </div>
            {credit.transactions.slice(0, 6).map((transaction) => {
              const signedAmount = transaction.direction === 'debit' ? -transaction.amountCents : transaction.amountCents;
              return (
                <div key={transaction.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-900 p-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-200">{transaction.description || transaction.transactionType || 'Credit activity'}</div>
                    <div className="mt-1 truncate text-slate-500">{transaction.restaurantName || 'OxSteed'} · {transaction.status} · {formatWhen(transaction.postedAt || transaction.createdAt)}</div>
                  </div>
                  <strong className={signedAmount < 0 ? 'shrink-0 text-amber-200' : 'shrink-0 text-emerald-300'}>{signedAmount < 0 ? '-' : '+'}{formatMoney(Math.abs(signedAmount), transaction.currencyCode)}</strong>
                </div>
              );
            })}
            {credit.disputes.slice(0, 3).map((dispute) => (
              <div key={dispute.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100">
                <div className="font-semibold">Dispute · {dispute.status}</div>
                <div className="mt-1 text-amber-200/80">{dispute.reasonCode} · {dispute.restaurantName || 'OxSteed Credit'}</div>
              </div>
            ))}
            {!credit.transactions.length && !credit.disputes.length && credit.accounts.length > 0 && <p className="text-xs text-slate-500">No recent credit activity or disputes.</p>}
            <p className="text-[10px] leading-4 text-slate-500">Restricted stored value. Customer credit is spendable only under active partner agreements.</p>
          </div>
        </details>
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Recent attachments</summary>
          <div className="mt-3 space-y-2">
            {attachments.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-lg bg-slate-900 p-2 text-xs">
                {item.attachment_url && isPreviewableImage(item) && (
                  <a
                    href={item.attachment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-2 block overflow-hidden rounded-md border border-slate-700 bg-slate-950"
                  >
                    <img
                      src={item.attachment_url}
                      alt={item.attachment_name || 'Support attachment preview'}
                      loading="lazy"
                      className="max-h-32 w-full object-contain"
                    />
                  </a>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-200">{item.attachment_name || 'Support attachment'}</div>
                  {item.attachment_url && (
                    <span className="flex items-center gap-2">
                      <a
                        href={item.attachment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-300 hover:text-blue-200 hover:underline"
                      >
                        Open
                      </a>
                      <a
                        href={item.attachment_url}
                        download={item.attachment_name || true}
                        className="text-orange-300 hover:text-orange-200 hover:underline"
                      >
                        Download
                      </a>
                    </span>
                  )}
                </div>
                <div className="mt-1 text-slate-500">{item.subject || 'Support conversation'} · {formatWhen(item.created_at)}</div>
              </div>
            ))}
            {!attachments.length && <p className="text-xs text-slate-500">No active attachments found.</p>}
          </div>
        </details>
        <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">Lifecycle timeline</summary>
          <div className="mt-3 space-y-2">
            {lifecycleLoading && <p className="text-xs text-slate-500">Loading lifecycle…</p>}
            {!lifecycleLoading && lifecycle.slice(-12).map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs">
                <div className="font-semibold text-slate-200">
                  {event.status_from ? `${event.status_from} → ` : ''}{event.status_to}
                </div>
                <div className="mt-1 text-slate-500">{event.changed_by_name || 'System'} · {formatWhen(event.changed_at)}</div>
                {event.change_reason && <div className="mt-1 text-slate-400">{event.change_reason}</div>}
              </div>
            ))}
            {!lifecycleLoading && !lifecycle.length && <p className="text-xs text-slate-500">No lifecycle events recorded yet.</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
