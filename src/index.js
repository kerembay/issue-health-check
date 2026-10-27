import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import kvsDefault, { kvs as kvsNamed } from '@forge/kvs';
import { evaluateIssueHealth, extractTextFromAdf, validateSettings, DEFAULT_SETTINGS } from './rules.js';
import { ERROR_CODES } from './errors.js';

const kvs = kvsNamed || kvsDefault;
const resolver = new Resolver();

// --- Sonuç biçimi ve hata yönetimi -------------------------------------------
//
// Her resolver frontend'e aynı biçimde bir nesne döner:
//   başarılı:  { ok: true, data: ... }
//   başarısız: { ok: false, error: { code: 'NO_PERMISSION', details?: ... } }
//
// Neden throw etmiyoruz? Resolver içinden fırlatılan her hata Forge tarafından
// "unhandled" olarak `forge logs`'a ERROR seviyesinde yazılır ve frontend'e
// teknik bir mesajla ulaşır. Yetki yok, issue bulunamadı gibi BEKLENEN durumlar
// hata değil, normal birer sonuçtur; bunları kodlu bir yanıt olarak döneriz ve
// frontend kodu kullanıcıya anlaşılır bir mesaja çevirir.

// Beklenen bir hata durumunu temsil eder. Resolver gövdesinde fırlatılır ve
// defineResolver tarafından yakalanıp { ok: false, error } yanıtına çevrilir.
class ResolverError extends Error {
  constructor(code, details) {
    super(code);
    this.name = 'ResolverError';
    this.code = code;
    this.details = details;
  }
}

// Jira'nın HTTP durum kodunu bizim hata kodlarımızdan birine çevirir.
const jiraStatusToError = (status) => {
  if (status === 401 || status === 403) return new ResolverError(ERROR_CODES.NO_PERMISSION, { status });
  if (status === 404) return new ResolverError(ERROR_CODES.NOT_FOUND, { status });
  return new ResolverError(ERROR_CODES.JIRA_ERROR, { status });
};

// resolver.define'ı saran yardımcı. Gövde fonksiyonu sadece "mutlu yolu" yazar
// ve dönüş değeri { ok: true, data } içine konur. Beklenen hatalar (ResolverError)
// kodlu yanıta çevrilir. Beklenmeyen hatalar da yakalanır ama loglanır; log'a
// issue içeriği, isim veya e-posta değil sadece resolver adı ve hata türü yazılır.
const defineResolver = (name, fn) => {
  resolver.define(name, async (req) => {
    try {
      return { ok: true, data: await fn(req) };
    } catch (err) {
      if (err instanceof ResolverError) {
        const error = { code: err.code };
        if (err.details !== undefined) error.details = err.details;
        return { ok: false, error };
      }
      console.error(`[${name}] unexpected error: ${err?.name || 'Error'}`);
      return { ok: false, error: { code: ERROR_CODES.UNEXPECTED } };
    }
  });
};

// --- Ayarların saklanması -----------------------------------------------------

// Ayarlar her proje için KVS'de tek bir anahtarda tutulur: `settings-<projectId>`.
// Proje anahtarı (ör. "ABC") yerine sayısal proje ID'sini kullanıyoruz çünkü
// anahtar proje yeniden adlandırılınca değişebilir, ID ise hiç değişmez.
const settingsStorageKey = (projectId) => `settings-${projectId}`;

// Ayarların hangi projeye ait olduğunu belirlemek için proje ID'sini bulur.
// 1. Forge context'i proje ID'sini veriyorsa (ör. jira:projectSettingsPage
//    context.extension.project.id) doğrudan onu kullanırız.
// 2. Context'te sadece proje anahtarı (key, ör. "ABC") varsa ID'yi Jira'dan
//    GET /rest/api/3/project/{key} ile çözeriz. İstek .asUser() ile yapıldığı
//    için kullanıcının göremediği bir projenin ID'si de çözülemez.
// 3. İkisi de yoksa null döner; çağıran taraf ne yapacağına kendisi karar verir.
// Çözümleme başarısız olursa hata kodu döneriz: sessizce varsayılan ayarlara
// düşmek, yöneticinin yanlışlıkla kayıtlı ayarların üzerine yazmasına yol açabilir.
const resolveProjectId = async (req) => {
  const project = req.context?.extension?.project;
  if (project?.id) return project.id;
  if (!project?.key) return null;

  const response = await api.asUser().requestJira(route`/rest/api/3/project/${project.key}`);
  if (!response.ok) throw jiraStatusToError(response.status);

  const data = await response.json();
  if (!data?.id) throw new ResolverError(ERROR_CODES.JIRA_ERROR, { reason: 'PROJECT_ID_MISSING' });
  return data.id;
};

// Bir projenin kayıtlı ayarlarını okur. Hiç kayıt yoksa varsayılanları döner;
// kayıt varsa varsayılanlarla birleştiririz ki sonradan eklenen yeni ayar
// alanları eski kayıtlarda da bir değere sahip olsun.
const loadSettings = async (projectId) => {
  const savedSettings = await kvs.get(settingsStorageKey(projectId));
  return savedSettings ? { ...DEFAULT_SETTINGS, ...savedSettings } : DEFAULT_SETTINGS;
};

// --- Resolver'lar -------------------------------------------------------------

defineResolver('getSettings', async (req) => {
  const projectId = await resolveProjectId(req);
  if (!projectId) return DEFAULT_SETTINGS;

  return loadSettings(projectId);
});

defineResolver('saveSettings', async (req) => {
  const projectId = await resolveProjectId(req);
  if (!projectId) throw new ResolverError(ERROR_CODES.NO_PROJECT_CONTEXT);

  // R9: Güvenlik Kontrolü - Kullanıcının "ADMINISTER_PROJECTS" yetkisi var mı?
  // Ayarlar sayfasını Jira zaten sadece proje yöneticilerine gösterir, ama
  // resolver doğrudan da çağrılabileceği için yetkiyi backend'de tekrar kontrol ediyoruz.
  const permissionRes = await api
    .asUser()
    .requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`);
  if (!permissionRes.ok) throw jiraStatusToError(permissionRes.status);

  const permissionsData = await permissionRes.json();
  if (!permissionsData.permissions?.ADMINISTER_PROJECTS?.havePermission) {
    throw new ResolverError(ERROR_CODES.NOT_PROJECT_ADMIN);
  }

  // Frontend de doğrulama yapıyor ama resolver doğrudan çağrılabileceği için
  // sunucu tarafında tekrar doğruluyoruz. Sadece temizlenmiş ayarları kaydediyoruz.
  const { valid, errors, settings: newSettings } = validateSettings(req.payload);
  if (!valid) throw new ResolverError(ERROR_CODES.INVALID_SETTINGS, errors);

  await kvs.set(settingsStorageKey(projectId), newSettings);
  return newSettings;
});

defineResolver('getIssueHealth', async (req) => {
  const issueId = req.context?.extension?.issue?.id || req.context?.extension?.issue?.key;
  if (!issueId) throw new ResolverError(ERROR_CODES.NO_ISSUE_CONTEXT);

  // Sadece kontrollerin ihtiyaç duyduğu alanları istiyoruz.
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueId}?fields=project,status,description,assignee,duedate,updated,labels`);
  if (!response.ok) throw jiraStatusToError(response.status);

  const data = await response.json();
  const fields = data.fields;
  const descriptionText = extractTextFromAdf(fields.description);

  const issueData = {
    // Done tespiti için statü kategorisinin dilden bağımsız "key" alanını kullanıyoruz
    // ('new' | 'indeterminate' | 'done'). Çevrilebilen "name" alanına güvenmiyoruz.
    statusCategoryKey: fields.status?.statusCategory?.key || '',
    descriptionText: descriptionText,
    assignee: fields.assignee,
    dueDate: fields.duedate || null,
    updated: fields.updated,
    labels: fields.labels || [],
  };

  // Proje ID'sini Jira'nın döndürdüğü issue verisinden alıyoruz; bu, issue'nun
  // gerçekten ait olduğu projedir. Yanıtta yoksa context'ten çözmeyi deneriz;
  // o da yoksa varsayılan ayarlar kullanılır.
  const projectId = fields.project?.id || (await resolveProjectId(req));
  const currentSettings = projectId ? await loadSettings(projectId) : DEFAULT_SETTINGS;

  return evaluateIssueHealth(issueData, currentSettings);
});

export const handler = resolver.getDefinitions();
