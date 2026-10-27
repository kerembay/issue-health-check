import { ERROR_CODES } from '../errors.js';

// Resolver'ların döndürdüğü hata kodlarını kullanıcıya gösterilecek anlaşılır
// mesajlara çevirir. Hem issue paneli hem de ayarlar sayfası bu dosyayı kullanır.
const MESSAGES = {
  [ERROR_CODES.NO_ISSUE_CONTEXT]: 'This panel only works on an issue.',
  [ERROR_CODES.NO_PROJECT_CONTEXT]: "Couldn't find the project. Reload the page and try again.",
  [ERROR_CODES.NO_PERMISSION]: "You don't have permission to view this data.",
  [ERROR_CODES.NOT_FOUND]: "The issue or project wasn't found, or you don't have permission to view it.",
  [ERROR_CODES.JIRA_ERROR]: "Jira couldn't respond right now. Try again in a moment.",
  [ERROR_CODES.NOT_PROJECT_ADMIN]: 'You must be a project admin to save these settings.',
  [ERROR_CODES.INVALID_SETTINGS]: 'The settings are not valid, so nothing was saved.',
  [ERROR_CODES.UNEXPECTED]: 'Something went wrong. Reload the page and try again.',
};

// error: resolver yanıtındaki { code, details? } nesnesi. Bilinmeyen veya eksik
// kodlarda genel mesaja düşeriz; kullanıcıya hiçbir zaman ham teknik metin göstermeyiz.
export const getErrorMessage = (error) => MESSAGES[error?.code] || MESSAGES[ERROR_CODES.UNEXPECTED];
