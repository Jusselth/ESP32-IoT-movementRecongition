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
 * Permite renderizar y adjuntar una ráfaga de múltiples fotografías en un solo mensaje.
 * @param log Registro del evento generado
 * @param dto Datos opcionales recibidos (incluye arreglo o imagen individual en Base64)
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

    // Unificar imágenes recibidas (prioriza 'imagesBase64' y cae en 'imageBase64')
    const rawImages: string[] = dto?.imagesBase64 && dto.imagesBase64.length > 0
      ? dto.imagesBase64
      : dto?.imageBase64
        ? [dto.imageBase64]
        : [];

    const attachments: any[] = [];
    let imagesHtml = '';

    // Generar adjuntos e imágenes embebidas vía CID
    rawImages.forEach((imgBase64, index) => {
      const base64Data = imgBase64.replace(/^data:image\/\w+;base64,/, '').trim();
      const cidName = `intrusion_image_${index + 1}`;

      attachments.push({
        filename: `intrusion-${log.id}-${index + 1}.jpg`,
        content: Buffer.from(base64Data, 'base64'),
        cid: cidName,
      });

      imagesHtml += `
        <div style="margin-top: 15px; text-align: center;">
          <p style="margin: 5px 0; color: #555; font-size: 13px; font-weight: bold;">
            Fotograma ${index + 1} de ${rawImages.length} (Secuencia a 0.5s)
          </p>
          <img src="cid:${cidName}" alt="Evidencia ${index + 1}" style="max-width: 100%; height: auto; border: 1px solid #ccc; border-radius: 6px;" />
        </div>
      `;
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #d9534f; margin-top: 0;">🚨 ALERTA DE INTRUSIÓN DETECTADA</h2>
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

        ${rawImages.length > 0 ? `
          <div style="margin-top: 20px;">
            <h3 style="color: #d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 5px;">Secuencia de Evidencias Capturadas (${rawImages.length}):</h3>${imagesHtml}
          </div>
        ` : ''}

        <hr style="margin-top: 25px; border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #777; text-align: center;">Sistema IoT de Detección de Intrusos</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"${config.smtp.from}" <${config.smtp.user}>`,
      to: recipient,
      subject: `ALERTA: Intrusión Detectada [${log.triggerSource}] (${rawImages.length} fotos)`,
      html: htmlContent,
      attachments,
    });

    console.log(`Correo enviado con éxito. ID: ${info.messageId} | Imágenes adjuntas: ${rawImages.length}`);
    return true;
  } catch (error) {
    console.error('Error al enviar el correo de alerta:', error);
    return false;
  }
}