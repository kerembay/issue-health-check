import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import kvsDefault, { kvs as kvsNamed } from '@forge/kvs';
import { evaluateIssueHealth, extractTextFromAdf, validateSettings, DEFAULT_SETTINGS } from './rules.js';

const kvs = kvsNamed || kvsDefault;
const resolver = new Resolver();

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
// Çözümleme başarısız olursa hata fırlatırız: sessizce varsayılan ayarlara
// düşmek, yöneticinin yanlışlıkla kayıtlı ayarların üzerine yazmasına yol açabilir.
const resolveProjectId = async (req) => {
  const project = req.context?.extension?.project;
  if (project?.id) return project.id;
  if (!project?.key) return null;

  const response = await api.asUser().requestJira(route`/rest/api/3/project/${project.key}`);
  if (!response.ok) {
    throw new Error(`Proje ID'si çözümlenemedi (${project.key}): ${response.status}`);
  }

  const data = await response.json();
  if (!data?.id) {
    throw new Error(`Proje ID'si çözümlenemedi (${project.key}): yanıtta id yok.`);
  }
  return data.id;
};

// Bir projenin kayıtlı ayarlarını okur. Hiç kayıt yoksa varsayılanları döner;
// kayıt varsa varsayılanlarla birleştiririz ki sonradan eklenen yeni ayar
// alanları eski kayıtlarda da bir değere sahip olsun.
const loadSettings = async (projectId) => {
  const savedSettings = await kvs.get(settingsStorageKey(projectId));
  return savedSettings ? { ...DEFAULT_SETTINGS, ...savedSettings } : DEFAULT_SETTINGS;
};

resolver.define('getSettings', async (req) => {
  const projectId = await resolveProjectId(req);
  if (!projectId) return DEFAULT_SETTINGS;

  return loadSettings(projectId);
});

resolver.define('saveSettings', async (req) => {
  const projectId = await resolveProjectId(req);

  if (!projectId) throw new Error('Project ID or key not found in context.');

  // R9: Güvenlik Kontrolü - Kullanıcının "ADMINISTER_PROJECTS" yetkisi var mı?
  const permissionRes = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`
  );
  
  if (!permissionRes.ok) {
    throw new Error('Yetki doğrulanamadı.');
  }
  
  const permissionsData = await permissionRes.json();
  if (!permissionsData.permissions?.ADMINISTER_PROJECTS?.havePermission) {
    throw new Error('Erişim reddedildi: Ayarları kaydetmek için Proje Yöneticisi (Admin) olmalısınız.');
  }

  // Frontend de doğrulama yapıyor ama resolver doğrudan çağrılabileceği için
  // sunucu tarafında tekrar doğruluyoruz. Sadece temizlenmiş ayarları kaydediyoruz.
  const { valid, errors, settings: newSettings } = validateSettings(req.payload);
  if (!valid) {
    throw new Error(`Geçersiz ayarlar: ${errors.join(' ')}`);
  }

  await kvs.set(settingsStorageKey(projectId), newSettings);

  return true;
});

resolver.define('getIssueHealth', async (req) => {
  const issueId = req.context?.extension?.issue?.id || req.context?.extension?.issue?.key;
  if (!issueId) throw new Error('Issue ID not found in context.');

  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueId}?fields=project,status,description,assignee,duedate,updated,labels`);

  if (!response.ok) {
    throw new Error(`Failed to load issue data: ${response.status}`);
  }

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