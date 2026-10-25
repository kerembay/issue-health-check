import { evaluateIssueHealth, DEFAULT_SETTINGS } from './rules.js';

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
    // 4 varsayılan kural açık ve hepsi geçiyor
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
    // Varsayılan ayarlarda 4 kural açıktır. badIssue sadece "Recently Updated" kuralını geçer.
    // 1/4 = %25 Puan
    expect(result.score).toBe(25);
    expect(result.band).toBe('At risk');
  });
});