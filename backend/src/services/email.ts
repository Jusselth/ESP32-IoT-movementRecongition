import nodemailer from 'nodemailer';
import { config } from '../config';

export interface SendAlertEmailParams {
  imageBase64?: string;
  timestamp: string;
  triggerSource?: string;
  additionalInfo?: string;
  recipient?: string;
}

/**
 * Servicio de envío de correo de alerta mediante Nodemailer.
 * Recibe imagen en Base64, timestamp y detalles de la alerta.
 */
export async function sendAlertEmail(params: SendAlertEmailParams): Promise<boolean> {
  const targetEmail = params.recipient || config.SMTP_TO;

  if (!targetEmail) {
    console.warn('[EmailService] ⚠️ No se especificó un correo objetivo (SMTP_TO). Omitiendo envío.');
    return false;
  }

  if (!config.SMTP_USER && process.env.NODE_ENV !== 'test') {
    console.warn('[EmailService] ⚠️ Credenciales SMTP no configuradas en .env. Omitiendo envío real.');
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: (config.SMTP_USER && config.SMTP_PASS) ? {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      } : undefined,
    });

    const formattedDate = new Date(params.timestamp).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    const attachments = [];
    let imageHtmlTag = '';

    if (params.imageBase64 && params.imageBase64.trim() !== '') {
      // Limpiar prefijo data:image/...;base64, si viene incluido
      const base64Data = params.imageBase64.replace(/^data:image\/\w+;base64,/, '');

      attachments.push({
        filename: `evidencia_intrusio_${Date.now()}.jpg`,
        content: base64Data,
        encoding: 'base64',
        cid: 'evidence_photo', // Content-ID para incrustar en el HTML
      });

      imageHtmlTag = `
        <div style="margin-top: 20px; text-align: center;">
          <h3>Evidencia Fotográfica Capturada:</h3>
          <img src="cid:evidence_photo" alt="Evidencia de Intrusión" style="max-width: 100%; height: auto; border: 2px solid #e74c3c; border-radius: 8px;" />
        </div>
      `;
    }

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; background-color: #f4f6f8; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; border-left: 6px solid #e74c3c; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #e74c3c; margin-top: 0;">🚨 ALERTA CRÍTICA: Intrusión Detectada</h2>
          <p style="font-size: 16px; color: #333;">Se ha detectado un evento de movimiento o intrusión no autorizada en el sistema de vigilancia IoT.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr>
              <td style="padding: 8px; font-weight: bold; color: #555;">Fecha / Hora:</td>
              <td style="padding: 8px; color: #222;">${formattedDate} (${params.timestamp})</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; color: #555;">Origen del Disparo:</td>
              <td style="padding: 8px; color: #222;">${params.triggerSource || 'DESCONOCIDO'}</td>
            </tr>
            ${params.additionalInfo ? `
            <tr>
              <td style="padding: 8px; font-weight: bold; color: #555;">Detalles Adicionales:</td>
              <td style="padding: 8px; color: #222;">${params.additionalInfo}</td>
            </tr>` : ''}
          </table>

          ${imageHtmlTag}

          <hr style="margin-top: 25px; border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #888; text-align: center;">Sistema de Detección de Intrusos IoT - Panel Backend Central</p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"${config.SMTP_FROM}" <${config.SMTP_USER || config.SMTP_FROM}>`,
      to: targetEmail,
      subject: `🚨 ALERTA DE INTRUSIÓN DETECTADA - ${params.timestamp}`,
      html: htmlBody,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] ✅ Correo de alerta enviado exitosamente. ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[EmailService] ❌ Error al enviar correo de alerta:', error);
    return false;
  }
}
