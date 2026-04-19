-- Add email delivery tracking columns to invoice_delivery_log
-- Supports tracking actual email send success/failure with error details

ALTER TABLE invoice_delivery_log
ADD COLUMN email_sent_at TIMESTAMP DEFAULT NULL;

ALTER TABLE invoice_delivery_log
ADD COLUMN email_delivery_errors TEXT DEFAULT NULL;

-- Create index for filtering failed deliveries
CREATE INDEX idx_invoice_delivery_log_status ON invoice_delivery_log(delivery_status)
WHERE delivery_status = 'failed';

-- Create index for email delivery tracking
CREATE INDEX idx_invoice_delivery_log_email_sent ON invoice_delivery_log(email_sent_at DESC)
WHERE email_sent_at IS NOT NULL;
