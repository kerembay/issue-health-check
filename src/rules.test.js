import { evaluateIssueHealth, DEFAULT_SETTINGS, extractTextFromAdf } from './rules.js';

describe('Issue Health Check Rules Engine', () => {
  // Testlerde kullanacağımız, tüm kuralları geçen kusursuz bir örnek görev
  const perfectIssue = {
    statusCategory: 'In Progress',
    descriptionText: 'Bu açıklama otuz karakterden kesinlikle daha uzundur.', // 53 karakter
    assignee: { accountId: '123' },
    dueDate: new Date(Date.now() + 86400000).toISOString(), // Yarının tarihi
    updated: new Date().toISOString(), // Bugün güncellenmiş
    labels: ['test-label']
  };

  test('Uç Durum (R3): Görev "Done" statüsündeyse isDone döner', () => {
    const doneIssue = { ...perfectIssue, statusCategory: 'Done' };
    const result = evaluateIssueHealth(doneIssue, DEFAULT_SETTINGS);
    expect(result.isDone).toBe(true);
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