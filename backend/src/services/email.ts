import nodemailer from 'nodemailer';
import { config } from '../config';
import { IntrusionLog, ReportAlertDto } from '../../../shared/types';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

/**
 * Envía una alerta por correo electrónico ante la detección de una intrusión.
 * @param log Registro del evento generado
 * @param dto Datos opcionales recibidos (incluye fotografía en Base64)
 */
export async function sendIntrusionAlertEmail(
  log: IntrusionLog,
  dto?: ReportAlertDto
): Promise<boolean> {
  try {
    const recipient = log.emailRecipient || config.alertRecipient;

    if (!recipient) {
      console.warn('No hay un correo destinatario configurado para el envío de alertas.');
      return false;
    }

    const attachments = [];
    if (dto?.imageBase64) {
      const base64Data = dto.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      attachments.push({
        filename: `intrusion-${log.id}.jpg`,
        content: Buffer.from(base64Data, 'base64'),
        cid: 'intrusion_image',
      });
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #d9534f;">🚨 ALERTA DE INTRUSIÓN DETECTADA</h2>
        <p>Se ha registrado un evento de intrusión en el sistema de seguridad.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">ID de Evento:</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${log.id}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Origen:</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${log.triggerSource}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Fecha y Hora:</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${new Date(log.timestamp).toLocaleString()}</td>
          </tr>
        </table>

        ${dto?.imageBase64
        ? `<div style="margin-top: 20px;">
                <h3>Evidencia Capturada:</h3>
                <img src="cid:intrusion_image" alt="Evidencia de intrusión" style="max-width: 100%; height: auto; border: 1px solid #ccc; border-radius: 4px;" />
               </div>`
        : ''
      }

        <hr style="margin-top: 25px; border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #777;">Sistema IoT de Detección de Intrusos</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"${config.smtp.from}" <${config.smtp.user}>`,
      to: recipient,
      subject: `ALERTA: Intrusión Detectada [${log.triggerSource}]`,
      html: htmlContent,
      attachments,
    });

    console.log(`Correo enviado con éxito. ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error al enviar el correo de alerta:', error);
    return false;
  }
}