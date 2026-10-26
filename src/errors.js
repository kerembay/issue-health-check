// Resolver'ların frontend'e döndürdüğü hata kodları. Hem backend (src/index.js)
// hem de frontend (src/frontend/*.jsx) bu dosyayı kullanır; böylece kodlar tek
// yerde tanımlanır ve iki taraf aynı değerleri karşılaştırır. Forge'a bağımlı
// değildir, bu yüzden her iki tarafta da güvenle import edilebilir.
export const ERROR_CODES = {
  // Modül context'inde issue bilgisi yok (panel issue dışında açılmış).
  NO_ISSUE_CONTEXT: 'NO_ISSUE_CONTEXT',
  // Modül context'inde proje ID'si de anahtarı da yok.
  NO_PROJECT_CONTEXT: 'NO_PROJECT_CONTEXT',
  // Jira 401/403 döndü: kullanıcının bu veriye erişim izni yok.
  NO_PERMISSION: 'NO_PERMISSION',
  // Jira 404 döndü: issue/proje yok ya da kullanıcı göremiyor.
  NOT_FOUND: 'NOT_FOUND',
  // Jira başka bir hata kodu döndü (ör. 500, 429).
  JIRA_ERROR: 'JIRA_ERROR',
  // Ayarları kaydetmeye çalışan kullanıcı proje yöneticisi değil.
  NOT_PROJECT_ADMIN: 'NOT_PROJECT_ADMIN',
  // Kaydedilmek istenen ayarlar validateSettings kontrolünden geçmedi.
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  // Beklenmeyen bir hata (ör. depolama veya ağ hatası).
  UNEXPECTED: 'UNEXPECTED',
};
