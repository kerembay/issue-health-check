import { evaluateIssueHealth, DEFAULT_SETTINGS, extractTextFromAdf, isDoneStatus, validateSettings } from './rules.js';

describe('Issue Health Check Rules Engine', () => {
  // Testlerde kullanacağımız, tüm kuralları geçen kusursuz bir örnek görev
  const perfectIssue = {
    statusCategoryKey: 'indeterminate',
    descriptionText: 'Bu açıklama otuz karakterden kesinlikle daha uzundur.', // 53 karakter
    assignee: { accountId: '123' },
    dueDate: new Date(Date.now() + 86400000).toISOString(), // Yarının tarihi
    updated: new Date().toISOString(), // Bugün güncellenmiş
    labels: ['test-label'],
  };

  test('Uç Durum (R3): Statü kategorisi key değeri "done" ise isDone döner', () => {
    const doneIssue = { ...perfectIssue, statusCategoryKey: 'done' };
    const result = evaluateIssueHealth(doneIssue, DEFAULT_SETTINGS);
    expect(result.isDone).toBe(true);
  });

  test('Uç Durum (R3): "new" ve "indeterminate" kategorileri Done sayılmaz', () => {
    for (const key of ['new', 'indeterminate', '']) {
      const issue = { ...perfectIssue, statusCategoryKey: key };
      const result = evaluateIssueHealth(issue, DEFAULT_SETTINGS);
      expect(result.isDone).toBeUndefined();
      expect(result.score).toBe(100);
    }
  });

  test('Uç Durum (R3): Done tespiti çevrilmiş statü adlarına bakmaz', () => {
    // Eski davranışta ad karşılaştırması yapılıyordu; artık sadece key önemli.
    const issue = { ...perfectIssue, statusCategory: 'Done', statusCategoryKey: 'indeterminate' };
    expect(evaluateIssueHealth(issue, DEFAULT_SETTINGS).isDone).toBeUndefined();
  });

  test.each([
    ['done', true],
    ['new', false],
    ['indeterminate', false],
    ['', false],
    [undefined, false],
    ['Done', false], // key her zaman küçük harftir; ad benzeri değerler Done sayılmaz
  ])('isDoneStatus(%p) → %p', (key, expected) => {
    expect(isDoneStatus(key)).toBe(expected);
  });

  test('Uç Durum (R3): Tüm ayarlar kapalıysa noChecksEnabled döner', () => {
    const allOffSettings = {
      descriptionEnabled: false,
      assigneeEnabled: false,
      dueDateEnabled: false,
      recentlyUpdatedEnabled: false,
      labelsEnabled: false,
    };
    const result = evaluateIssueHealth(perfectIssue, allOffSettings);
    expect(result.noChecksEnabled).toBe(true);
  });

  test('Varsayılan ayarlarda kusursuz görev %100 "Healthy" puan alır', () => {
    const result = evaluateIssueHealth(perfectIssue, DEFAULT_SETTINGS);
    expect(result.score).toBe(100);
    expect(result.band).toBe('Healthy');
  });

  test('Kurallar ihlal edildiğinde puan düşer ve "At risk" bandına geçer', () => {
    const badIssue = {
      ...perfectIssue,
      descriptionText: 'Kısa', // 30 karakterden kısa
      assignee: null, // Atanan kişi yok
      dueDate: null, // Bitiş tarihi yok
    };
    const result = evaluateIssueHealth(badIssue, DEFAULT_SETTINGS);
    expect(result.score).toBe(25);
    expect(result.band).toBe('At risk');
  });

  // --- Görev 2 İçin Eklenen Testler ---

  test('Skor bandı: 80 puan tam sınırında "Healthy" kalır', () => {
    const settings = { ...DEFAULT_SETTINGS, labelsEnabled: true };
    const issue = { ...perfectIssue, labels: [] }; // Sadece labels başarısız (4/5)
    const result = evaluateIssueHealth(issue, settings);
    expect(result.score).toBe(80);
    expect(result.band).toBe('Healthy');
  });

  test('Skor bandı: 50 puan tam sınırında "Need attention" olur', () => {
    const issue = { ...perfectIssue, assignee: null, dueDate: null }; // 2 kural başarısız (2/4)
    const result = evaluateIssueHealth(issue, DEFAULT_SETTINGS);
    expect(result.score).toBe(50);
    expect(result.band).toBe('Need attention');
  });

  test('Geçmiş ve bugünkü due date kontrolleri', () => {
    const pastIssue = { ...perfectIssue, dueDate: new Date(Date.now() - 86400000).toISOString() };
    expect(evaluateIssueHealth(pastIssue, DEFAULT_SETTINGS).results.find((r) => r.name === 'Due date').passed).toBe(
      false
    );

    const todayIssue = { ...perfectIssue, dueDate: new Date().toISOString() };
    expect(evaluateIssueHealth(todayIssue, DEFAULT_SETTINGS).results.find((r) => r.name === 'Due date').passed).toBe(
      true
    );
  });

  test('Bayat (stale) issue kontrolü', () => {
    const staleIssue = { ...perfectIssue, updated: new Date(Date.now() - 15 * 86400000).toISOString() }; // 15 gün önce
    expect(
      evaluateIssueHealth(staleIssue, DEFAULT_SETTINGS).results.find((r) => r.name === 'Recently updated').passed
    ).toBe(false);
  });

  test('Labels (etiketler) açıkken kontrol', () => {
    const settings = { ...DEFAULT_SETTINGS, labelsEnabled: true };
    expect(evaluateIssueHealth(perfectIssue, settings).results.find((r) => r.name === 'Labels').passed).toBe(true);

    const noLabelIssue = { ...perfectIssue, labels: [] };
    expect(evaluateIssueHealth(noLabelIssue, settings).results.find((r) => r.name === 'Labels').passed).toBe(false);
  });

  test('Açıklama uzunluğu sınırı kontrolü', () => {
    const customSettings = { ...DEFAULT_SETTINGS, minDescriptionLength: 100 };
    expect(evaluateIssueHealth(perfectIssue, customSettings).results.find((r) => r.name === 'Description').passed).toBe(
      false
    );
  });

  test('Açıklama kontrolü: sadece boşluktan oluşan açıklama geçmez', () => {
    const blankIssue = { ...perfectIssue, descriptionText: ' '.repeat(40) + '\n\t\n' };
    const result = evaluateIssueHealth(blankIssue, DEFAULT_SETTINGS).results.find((r) => r.name === 'Description');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('currently 0');
  });

  test('Açıklama kontrolü: baş/son boşluklar uzunluğa sayılmaz', () => {
    // 29 anlamlı karakter + boşluklar: ham uzunluk 30'u geçse de kontrol başarısız olmalı
    const padded = { ...perfectIssue, descriptionText: '   ' + 'a'.repeat(29) + '   ' };
    expect(evaluateIssueHealth(padded, DEFAULT_SETTINGS).results.find((r) => r.name === 'Description').passed).toBe(
      false
    );

    // Tam 30 anlamlı karakter: sınırda geçer (aradaki boşluklar sayılır)
    const exact = { ...perfectIssue, descriptionText: '  ' + 'a'.repeat(14) + '  ' + 'b'.repeat(14) + '  ' };
    expect(evaluateIssueHealth(exact, DEFAULT_SETTINGS).results.find((r) => r.name === 'Description').passed).toBe(
      true
    );
  });

  test('Açıklama kontrolü: açıklama hiç yoksa (undefined) hata vermeden başarısız olur', () => {
    const noDesc = { ...perfectIssue, descriptionText: undefined };
    expect(evaluateIssueHealth(noDesc, DEFAULT_SETTINGS).results.find((r) => r.name === 'Description').passed).toBe(
      false
    );
  });

  test('ADF metin çıkarma (extractTextFromAdf)', () => {
    const adf = {
      content: [{ type: 'text', text: 'Hello ' }, { content: [{ type: 'text', text: 'World' }] }],
    };
    expect(extractTextFromAdf(adf)).toBe('Hello World');
    expect(extractTextFromAdf(null)).toBe('');
  });

  test('ADF metin çıkarma: metinsiz düğümler (ör. hardBreak) atlanır', () => {
    const adf = {
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Satır 1' }, { type: 'hardBreak' }, { type: 'text', text: 'Satır 2' }],
        },
        { type: 'rule' },
      ],
    };
    expect(extractTextFromAdf(adf)).toBe('Satır 1Satır 2');
    expect(extractTextFromAdf({ type: 'doc' })).toBe('');
  });
});

describe('DEFAULT_SETTINGS', () => {
  test('Ödevdeki kontrol tablosundaki varsayılanlarla birebir aynıdır', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      descriptionEnabled: true,
      minDescriptionLength: 30,
      assigneeEnabled: true,
      dueDateEnabled: true,
      recentlyUpdatedEnabled: true,
      staleLimitDays: 14,
      labelsEnabled: false,
    });
  });

  test('Varsayılanlarda 4 kontrol çalışır, Labels kapalıdır', () => {
    const issue = {
      statusCategoryKey: 'new',
      descriptionText: '',
      assignee: null,
      dueDate: null,
      updated: new Date().toISOString(),
      labels: [],
    };
    const names = evaluateIssueHealth(issue, DEFAULT_SETTINGS).results.map((r) => r.name);
    expect(names).toEqual(['Description', 'Assignee', 'Due date', 'Recently updated']);
  });
});

// Bu bölümde saat sabitlenir (jest fake timers) ve testler UTC'de çalışır
// (bkz. jest.global-setup.js). Böylece "bugün", "dün" ve "14 gün önce" gibi
// sınır durumları her çalıştırmada aynı sonucu verir.
describe('Kontrol ayrıntıları (sabit saat: 2026-10-26 12:00 UTC)', () => {
  const NOW = new Date('2026-10-26T12:00:00Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (days) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

  // Tüm kontrolleri geçen temel issue. dueDate, Jira'nın döndürdüğü gibi
  // sadece tarih (YYYY-MM-DD) formatındadır.
  const baseIssue = {
    statusCategoryKey: 'indeterminate',
    descriptionText: 'Bu açıklama otuz karakterden kesinlikle daha uzundur.',
    assignee: { accountId: '123' },
    dueDate: '2026-10-27',
    updated: NOW.toISOString(),
    labels: ['backend'],
  };

  // Sadece tek bir kontrolü açan ayar nesnesi üretir; böylece her kontrolü ayrı test ederiz.
  const only = (key, extra = {}) => ({
    descriptionEnabled: false,
    assigneeEnabled: false,
    dueDateEnabled: false,
    recentlyUpdatedEnabled: false,
    labelsEnabled: false,
    minDescriptionLength: 30,
    staleLimitDays: 14,
    [key]: true,
    ...extra,
  });

  const check = (issue, settings) => evaluateIssueHealth(issue, settings).results[0];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('Testler UTC saat diliminde çalışır', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  describe('Description', () => {
    test('Tam sınırda (30 karakter) geçer, 29 karakterde ipucuyla kalır', () => {
      const settings = only('descriptionEnabled');
      expect(check({ ...baseIssue, descriptionText: 'a'.repeat(30) }, settings).passed).toBe(true);

      const result = check({ ...baseIssue, descriptionText: 'a'.repeat(29) }, settings);
      expect(result.passed).toBe(false);
      expect(result.message).toBe('Add at least 30 characters to description (currently 29).');
    });
  });

  describe('Assignee', () => {
    test('Atanmış kişi varsa geçer', () => {
      expect(check(baseIssue, only('assigneeEnabled'))).toEqual({
        name: 'Assignee',
        passed: true,
        message: 'Assignee is set.',
      });
    });

    test.each([null, undefined])('Atanmış kişi %p ise ipucuyla kalır', (assignee) => {
      expect(check({ ...baseIssue, assignee }, only('assigneeEnabled'))).toEqual({
        name: 'Assignee',
        passed: false,
        message: 'Assign this issue to a team member.',
      });
    });
  });

  describe('Due date (Jira formatı: YYYY-MM-DD)', () => {
    test.each([
      ['2026-10-26', true], // bugün: henüz geçmedi
      ['2026-10-27', true], // yarın
      ['2027-01-01', true], // ileri bir tarih
      ['2026-10-25', false], // dün: geçmiş
      ['2025-12-31', false], // geçen yıl
    ])('Bitiş tarihi %s → geçti: %p', (dueDate, passed) => {
      expect(check({ ...baseIssue, dueDate }, only('dueDateEnabled')).passed).toBe(passed);
    });

    test('Geçmiş tarih ve eksik tarih için farklı ipuçları gösterilir', () => {
      const settings = only('dueDateEnabled');
      expect(check({ ...baseIssue, dueDate: '2026-10-25' }, settings).message).toBe(
        'Due date is in the past. Update or complete it.'
      );
      expect(check({ ...baseIssue, dueDate: null }, settings).message).toBe('Set a due date for this issue.');
    });

    test('Bugünün tarihi, günün son saniyesine kadar geçerli kalır', () => {
      jest.setSystemTime(new Date('2026-10-26T23:59:59Z'));
      expect(check({ ...baseIssue, dueDate: '2026-10-26' }, only('dueDateEnabled')).passed).toBe(true);

      jest.setSystemTime(new Date('2026-10-27T00:00:00Z'));
      expect(check({ ...baseIssue, dueDate: '2026-10-26' }, only('dueDateEnabled')).passed).toBe(false);
    });
  });

  describe('Recently updated', () => {
    test.each([
      [0, true],
      [14, true], // tam sınır: geçer
      [14.99, true], // gün farkı aşağı yuvarlanır (14)
      [15, false], // sınır aşıldı
      [60, false],
    ])('%p gün önce güncellenen issue → geçti: %p', (days, passed) => {
      expect(check({ ...baseIssue, updated: daysAgo(days) }, only('recentlyUpdatedEnabled')).passed).toBe(passed);
    });

    test('Bayat issue mesajı gün sayısını ve sınırı içerir', () => {
      const result = check({ ...baseIssue, updated: daysAgo(15) }, only('recentlyUpdatedEnabled'));
      expect(result.message).toBe("Issue hasn't been updated in 15 days (limit is 14).");
    });

    test('Özel stale sınırı (1 gün) kullanılır', () => {
      const settings = only('recentlyUpdatedEnabled', { staleLimitDays: 1 });
      expect(check({ ...baseIssue, updated: daysAgo(1) }, settings).passed).toBe(true);
      expect(check({ ...baseIssue, updated: daysAgo(2) }, settings).passed).toBe(false);
    });
  });

  describe('Labels', () => {
    test.each([
      [['backend'], true],
      [[], false],
      [undefined, false],
    ])('labels %p → geçti: %p', (labels, passed) => {
      expect(check({ ...baseIssue, labels }, only('labelsEnabled')).passed).toBe(passed);
    });
  });

  describe('Skor ve yuvarlama', () => {
    // Description, Assignee ve Due date açık; Recently updated ve Labels kapalı.
    const threeChecks = { ...only('descriptionEnabled'), assigneeEnabled: true, dueDateEnabled: true };

    test.each([
      [{}, 100, 'Healthy'],
      [{ assignee: null }, 67, 'Need attention'], // 2/3 = 66.67 → 67
      [{ assignee: null, dueDate: null }, 33, 'At risk'], // 1/3 = 33.33 → 33
      [{ assignee: null, dueDate: null, descriptionText: '' }, 0, 'At risk'],
    ])('3 kontrolde %p → %p (%s)', (overrides, score, band) => {
      const result = evaluateIssueHealth({ ...baseIssue, ...overrides }, threeChecks);
      expect(result.score).toBe(score);
      expect(result.band).toBe(band);
    });

    test('3/4 = 75 "Need attention" bandındadır (80 sınırının altı)', () => {
      const result = evaluateIssueHealth({ ...baseIssue, assignee: null }, DEFAULT_SETTINGS);
      expect(result.score).toBe(75);
      expect(result.band).toBe('Need attention');
    });

    test('Başarısız her kontrolün boş olmayan bir ipucu vardır', () => {
      const allOn = { ...DEFAULT_SETTINGS, labelsEnabled: true };
      const badIssue = {
        ...baseIssue,
        descriptionText: '',
        assignee: null,
        dueDate: null,
        updated: daysAgo(30),
        labels: [],
      };
      const { results, score } = evaluateIssueHealth(badIssue, allOn);
      expect(score).toBe(0);
      expect(results).toHaveLength(5);
      for (const result of results) {
        expect(result.passed).toBe(false);
        expect(result.message.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('validateSettings', () => {
  test('DEFAULT_SETTINGS geçerlidir ve aynen döner', () => {
    const result = validateSettings(DEFAULT_SETTINGS);
    expect(result).toEqual({ valid: true, errors: [], settings: DEFAULT_SETTINGS });
  });

  test('Girdiyi değiştirmez ve yeni bir nesne döner', () => {
    const input = { ...DEFAULT_SETTINGS, labelsEnabled: true };
    const snapshot = { ...input };
    const result = validateSettings(input);
    expect(input).toEqual(snapshot);
    expect(result.settings).not.toBe(input);
    expect(result.settings.labelsEnabled).toBe(true);
  });

  test('Eksik alanlar varsayılan değerleri alır', () => {
    const result = validateSettings({ staleLimitDays: 7 });
    expect(result.valid).toBe(true);
    expect(result.settings).toEqual({ ...DEFAULT_SETTINGS, staleLimitDays: 7 });
  });

  test('Bilinmeyen alanlar atılır', () => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, evil: 'x' });
    expect(result.valid).toBe(true);
    expect(result.settings).not.toHaveProperty('evil');
  });

  test.each([null, undefined, 'text', 42, []])('Nesne olmayan girdi reddedilir: %p', (input) => {
    const result = validateSettings(input);
    expect(result.valid).toBe(false);
    expect(result.settings).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  test('Boolean olmayan açık/kapalı değerleri reddedilir', () => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, assigneeEnabled: 'true', labelsEnabled: 1 });
    expect(result.valid).toBe(false);
    expect(result.settings).toBeNull();
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('assigneeEnabled');
    expect(result.errors[1]).toContain('labelsEnabled');
  });

  test.each([1, 30, 500])('minDescriptionLength sınır içi değer kabul edilir: %p', (value) => {
    expect(validateSettings({ minDescriptionLength: value }).valid).toBe(true);
  });

  test.each([0, 501, -5, 10.5, '30', NaN, Infinity, null])(
    'minDescriptionLength geçersiz değer reddedilir: %p',
    (value) => {
      const result = validateSettings({ minDescriptionLength: value });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('minDescriptionLength');
    }
  );

  test.each([1, 14, 365])('staleLimitDays sınır içi değer kabul edilir: %p', (value) => {
    expect(validateSettings({ staleLimitDays: value }).valid).toBe(true);
  });

  test.each([0, 366, 1.5, '14'])('staleLimitDays geçersiz değer reddedilir: %p', (value) => {
    const result = validateSettings({ staleLimitDays: value });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('staleLimitDays');
  });

  test('Birden fazla hata birlikte raporlanır', () => {
    const result = validateSettings({ minDescriptionLength: 0, staleLimitDays: 999, dueDateEnabled: 'no' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});
