export const DEFAULT_SETTINGS = {
  descriptionEnabled: true,
  minDescriptionLength: 30,
  assigneeEnabled: true,
  dueDateEnabled: true,
  recentlyUpdatedEnabled: true,
  staleLimitDays: 14,
  labelsEnabled: false,
};

// Ayar alanlarının izin verilen sınırları. Ayarlar sayfasındaki kurallarla aynıdır
// (R5): açıklama uzunluğu 1-500 karakter, bayatlık sınırı 1-365 gün.
export const SETTINGS_LIMITS = {
  minDescriptionLength: { min: 1, max: 500 },
  staleLimitDays: { min: 1, max: 365 },
};

// Hata mesajlarında alan adı (ör. "minDescriptionLength") yerine kullanıcının
// ayarlar sayfasında gördüğü okunabilir adı gösteriyoruz. Mesajlar hem backend
// yanıtında hem de ayarlar sayfasında aynen kullanıcıya gösterilir.
export const SETTING_LABELS = {
  descriptionEnabled: 'Description check',
  minDescriptionLength: 'Minimum description length',
  assigneeEnabled: 'Assignee check',
  dueDateEnabled: 'Due date check',
  recentlyUpdatedEnabled: 'Recently updated check',
  staleLimitDays: 'Stale limit (days)',
  labelsEnabled: 'Labels check',
};

// Açık/kapalı (boolean) olması gereken ayar alanları.
const BOOLEAN_SETTINGS = [
  'descriptionEnabled',
  'assigneeEnabled',
  'dueDateEnabled',
  'recentlyUpdatedEnabled',
  'labelsEnabled',
];

/**
 * Kaydedilmek istenen ayarları doğrular. Saf (pure) bir fonksiyondur: dışarıya
 * erişmez, girdiyi değiştirmez; bu sayede Forge olmadan kolayca test edilir.
 *
 * - Girdi düz bir nesne olmalıdır.
 * - Boolean alanlar gönderildiyse true/false olmalıdır.
 * - Sayısal alanlar gönderildiyse SETTINGS_LIMITS aralığında tam sayı olmalıdır.
 * - Gönderilmeyen alanlar DEFAULT_SETTINGS'teki değeri alır.
 * - Bilinmeyen alanlar sessizce atılır; böylece KVS'ye sadece tanıdığımız
 *   anahtarlar yazılır.
 *
 * @param {object} input Kullanıcıdan (resolver payload'ı) gelen ayarlar.
 * @returns {{ valid: boolean, errors: string[], settings: object | null }}
 *   valid true ise settings temizlenmiş ve kaydedilmeye hazır nesnedir,
 *   false ise settings null'dır ve errors hataları listeler.
 */
export const validateSettings = (input) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Settings must be an object.'], settings: null };
  }

  const errors = [];
  // Varsayılanlardan başlayıp sadece doğrulanan alanları üzerine yazıyoruz.
  const settings = { ...DEFAULT_SETTINGS };

  for (const key of BOOLEAN_SETTINGS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') {
      errors.push(`${SETTING_LABELS[key]} must be turned on or off.`);
    } else {
      settings[key] = input[key];
    }
  }

  for (const [key, { min, max }] of Object.entries(SETTINGS_LIMITS)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    // Number.isInteger, string ("30"), NaN, Infinity ve ondalıklı sayıları reddeder.
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${SETTING_LABELS[key]} must be a whole number from ${min} to ${max}.`);
    } else {
      settings[key] = value;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, settings: null };
  }
  return { valid: true, errors: [], settings };
};

export const extractTextFromAdf = (adf) => {
  if (!adf || !adf.content) return '';
  let text = '';
  for (const node of adf.content) {
    if (node.type === 'text' && node.text) {
      text += node.text;
    } else if (node.content) {
      text += extractTextFromAdf(node);
    }
  }
  return text;
};

// R3: Issue "Done" statü kategorisinde mi?
// Jira'da statü kategorisinin "name" alanı site diline göre çevrilir
// (ör. "Done", "Bitti", "Tamamlandı"), bu yüzden ad karşılaştırması güvenilir
// değildir. "key" alanı ise dilden bağımsızdır ve tamamlanmış statüler için
// her zaman 'done' değerini taşır (diğerleri: 'new', 'indeterminate').
// Resolver da bunu kullanır: Done issue için ayarları okumaya gerek yoktur.
export const isDoneStatus = (statusCategoryKey) => statusCategoryKey === 'done';

export const evaluateIssueHealth = (issueData, settings) => {
  // R3: Görev Done ise hesaplamayı durdur.
  if (isDoneStatus(issueData.statusCategoryKey)) {
    return { isDone: true };
  }

  const results = [];
  let passedChecks = 0;
  let totalEnabled = 0;

  if (settings.descriptionEnabled) {
    totalEnabled++;
    // Baştaki/sondaki boşlukları saymıyoruz; aksi halde sadece boşluk veya
    // satır sonlarından oluşan bir açıklama minimum uzunluğu geçebilirdi.
    const length = (issueData.descriptionText || '').trim().length;
    if (length >= settings.minDescriptionLength) {
      passedChecks++;
      results.push({ name: 'Description', passed: true, message: 'Description meets minimum length.' });
    } else {
      results.push({
        name: 'Description',
        passed: false,
        message: `Add at least ${settings.minDescriptionLength} characters to description (currently ${length}).`,
      });
    }
  }

  if (settings.assigneeEnabled) {
    totalEnabled++;
    // Jira atanmamış issue için null döner; alan hiç gelmezse (undefined) de
    // "atanmamış" saymak için doğruluk (truthy) kontrolü yapıyoruz.
    if (issueData.assignee) {
      passedChecks++;
      results.push({ name: 'Assignee', passed: true, message: 'Assignee is set.' });
    } else {
      results.push({ name: 'Assignee', passed: false, message: 'Assign this issue to a team member.' });
    }
  }

  if (settings.dueDateEnabled) {
    totalEnabled++;
    if (issueData.dueDate) {
      const due = new Date(issueData.dueDate);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (due >= now) {
        passedChecks++;
        results.push({ name: 'Due date', passed: true, message: 'Due date is on track.' });
      } else {
        results.push({ name: 'Due date', passed: false, message: 'Due date is in the past. Update or complete it.' });
      }
    } else {
      results.push({ name: 'Due date', passed: false, message: 'Set a due date for this issue.' });
    }
  }

  if (settings.recentlyUpdatedEnabled) {
    totalEnabled++;
    const updated = new Date(issueData.updated);
    const now = new Date();
    const diffDays = Math.floor((now - updated) / (1000 * 60 * 60 * 24));

    if (diffDays <= settings.staleLimitDays) {
      passedChecks++;
      results.push({ name: 'Recently updated', passed: true, message: 'Issue was updated recently.' });
    } else {
      results.push({
        name: 'Recently updated',
        passed: false,
        message: `Issue hasn't been updated in ${diffDays} days (limit is ${settings.staleLimitDays}).`,
      });
    }
  }

  if (settings.labelsEnabled) {
    totalEnabled++;
    if (issueData.labels && issueData.labels.length > 0) {
      passedChecks++;
      results.push({ name: 'Labels', passed: true, message: 'Issue has at least one label.' });
    } else {
      results.push({ name: 'Labels', passed: false, message: 'Add at least one label to this issue.' });
    }
  }

  // R3: Bütün kurallar ayarlardan kapatılmışsa
  if (totalEnabled === 0) {
    return { noChecksEnabled: true };
  }

  const score = Math.round((passedChecks / totalEnabled) * 100);

  let band = 'At risk';
  if (score >= 80) band = 'Healthy';
  else if (score >= 50) band = 'Need attention';

  return { score, band, results };
};
