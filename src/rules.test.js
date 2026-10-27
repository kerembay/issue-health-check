import { evaluateIssueHealth, DEFAULT_SETTINGS, extractTextFromAdf } from './rules.js';

describe('Issue Health Check Rules Engine', () => {
  // Testlerde kullanacağımız, tüm kuralları geçen kusursuz bir örnek görev
  const perfectIssue = {
    statusCategoryKey: 'indeterminate',
    descriptionText: 'Bu açıklama otuz karakterden kesinlikle daha uzundur.', // 53 karakter
    assignee: { accountId: '123' },
    dueDate: new Date(Date.now() + 86400000).toISOString(), // Yarının tarihi
    updated: new Date().toISOString(), // Bugün güncellenmiş
    labels: ['test-label']
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
    expect(evaluateIssueHealth(pastIssue, DEFAULT_SETTINGS).results.find(r => r.name === 'Due date').passed).toBe(false);

    const todayIssue = { ...perfectIssue, dueDate: new Date().toISOString() };
    expect(evaluateIssueHealth(todayIssue, DEFAULT_SETTINGS).results.find(r => r.name === 'Due date').passed).toBe(true);
  });

  test('Bayat (stale) issue kontrolü', () => {
    const staleIssue = { ...perfectIssue, updated: new Date(Date.now() - 15 * 86400000).toISOString() }; // 15 gün önce
    expect(evaluateIssueHealth(staleIssue, DEFAULT_SETTINGS).results.find(r => r.name === 'Recently updated').passed).toBe(false);
  });

  test('Labels (etiketler) açıkken kontrol', () => {
    const settings = { ...DEFAULT_SETTINGS, labelsEnabled: true };
    expect(evaluateIssueHealth(perfectIssue, settings).results.find(r => r.name === 'Labels').passed).toBe(true);

    const noLabelIssue = { ...perfectIssue, labels: [] };
    expect(evaluateIssueHealth(noLabelIssue, settings).results.find(r => r.name === 'Labels').passed).toBe(false);
  });

  test('Açıklama uzunluğu sınırı kontrolü', () => {
    const customSettings = { ...DEFAULT_SETTINGS, minDescriptionLength: 100 };
    expect(evaluateIssueHealth(perfectIssue, customSettings).results.find(r => r.name === 'Description').passed).toBe(false);
  });

  test('Açıklama kontrolü: sadece boşluktan oluşan açıklama geçmez', () => {
    const blankIssue = { ...perfectIssue, descriptionText: ' '.repeat(40) + '\n\t\n' };
    const result = evaluateIssueHealth(blankIssue, DEFAULT_SETTINGS).results.find(r => r.name === 'Description');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('currently 0');
  });

  test('Açıklama kontrolü: baş/son boşluklar uzunluğa sayılmaz', () => {
    // 29 anlamlı karakter + boşluklar: ham uzunluk 30'u geçse de kontrol başarısız olmalı
    const padded = { ...perfectIssue, descriptionText: '   ' + 'a'.repeat(29) + '   ' };
    expect(evaluateIssueHealth(padded, DEFAULT_SETTINGS).results.find(r => r.name === 'Description').passed).toBe(false);

    // Tam 30 anlamlı karakter: sınırda geçer (aradaki boşluklar sayılır)
    const exact = { ...perfectIssue, descriptionText: '  ' + 'a'.repeat(14) + '  ' + 'b'.repeat(14) + '  ' };
    expect(evaluateIssueHealth(exact, DEFAULT_SETTINGS).results.find(r => r.name === 'Description').passed).toBe(true);
  });

  test('Açıklama kontrolü: açıklama hiç yoksa (undefined) hata vermeden başarısız olur', () => {
    const noDesc = { ...perfectIssue, descriptionText: undefined };
    expect(evaluateIssueHealth(noDesc, DEFAULT_SETTINGS).results.find(r => r.name === 'Description').passed).toBe(false);
  });

  test('ADF metin çıkarma (extractTextFromAdf)', () => {
    const adf = {
      content: [
        { type: 'text', text: 'Hello ' },
        { content: [{ type: 'text', text: 'World' }] }
      ]
    };
    expect(extractTextFromAdf(adf)).toBe('Hello World');
    expect(extractTextFromAdf(null)).toBe('');
  });
});