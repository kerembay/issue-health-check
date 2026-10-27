import { ERROR_CODES } from '../errors.js';

// Resolver'ların döndürdüğü hata kodlarını kullanıcıya gösterilecek anlaşılır
// mesajlara çevirir. Hem issue paneli hem de ayarlar sayfası bu dosyayı kullanır.
const MESSAGES = {
  [ERROR_CODES.NO_ISSUE_CONTEXT]: 'Bu panel sadece bir issue içinde çalışır.',
  [ERROR_CODES.NO_PROJECT_CONTEXT]: 'Proje bilgisi alınamadı. Sayfayı yenileyip tekrar deneyin.',
  [ERROR_CODES.NO_PERMISSION]: 'Bu veriyi görüntülemek için izniniz yok.',
  [ERROR_CODES.NOT_FOUND]: 'Issue veya proje bulunamadı ya da görüntüleme izniniz yok.',
  [ERROR_CODES.JIRA_ERROR]: 'Jira şu anda yanıt veremedi. Biraz sonra tekrar deneyin.',
  [ERROR_CODES.NOT_PROJECT_ADMIN]: 'Ayarları kaydetmek için proje yöneticisi olmalısınız.',
  [ERROR_CODES.INVALID_SETTINGS]: 'Ayarlar geçersiz olduğu için kaydedilmedi.',
  [ERROR_CODES.UNEXPECTED]: 'Beklenmeyen bir hata oluştu. Sayfayı yenileyip tekrar deneyin.',
};

// error: resolver yanıtındaki { code, details? } nesnesi. Bilinmeyen veya eksik
// kodlarda genel mesaja düşeriz; kullanıcıya hiçbir zaman ham teknik metin göstermeyiz.
export const getErrorMessage = (error) => MESSAGES[error?.code] || MESSAGES[ERROR_CODES.UNEXPECTED];
