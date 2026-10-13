/**
 * Checagens do ambiente: navegadores internos de apps costumam bloquear a
 * câmera, então avisamos antes e oferecemos copiar o link.
 */

const IN_APP_BROWSERS = [
  [/Instagram/i, 'Instagram'],
  [/Messenger|MessengerForiOS|Orca-Android/i, 'Messenger'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, 'Facebook'],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, 'TikTok'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Snapchat/i, 'Snapchat'],
  [/Pinterest/i, 'Pinterest'],
  [/\bLine\//, 'LINE'],
  [/Twitter/i, 'X'],
];

/** Nome do app cujo navegador interno está em uso, ou null. */
export function detectInAppBrowser(userAgent = '') {
  for (const [pattern, name] of IN_APP_BROWSERS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

/** Copia o endereço da página. Devolve true se deu certo. */
export async function copyPageLink(url = location.href) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }
}
