import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export interface AppConfig {
  port: number;
  nodeEnv: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  alertRecipient: string;
  supabase: {
    url: string;
    key: string;
  };
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || '',
  },
  alertRecipient: process.env.ALERT_RECIPIENT_EMAIL || '',
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
};