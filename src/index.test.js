// Resolver (src/index.js) testleri. Gerçek Forge çalışma ortamı olmadan test
// edebilmek için @forge/resolver, @forge/api ve @forge/kvs modüllerini mock'luyoruz.
// jest.mock çağrıları dosyanın en üstüne taşınır (hoist); bu yüzden fabrika
// fonksiyonları içinde sadece "mock" ile başlayan değişkenlere erişebiliriz.

const mockKvsGet = jest.fn();
const mockKvsSet = jest.fn();
const mockRequestJira = jest.fn();

// Basit bir Resolver taklidi: define() ile tanımlanan fonksiyonları bir nesnede
// toplar, getDefinitions() bu nesneyi döner. Böylece handler.getSettings(...)
// şeklinde doğrudan çağırabiliriz.
jest.mock('@forge/resolver', () => ({
  __esModule: true,
  default: class {
    constructor() {
      this.definitions = {};
    }
    define(name, fn) {
      this.definitions[name] = fn;
    }
    getDefinitions() {
      return this.definitions;
    }
  },
}));

jest.mock('@forge/api', () => ({
  __esModule: true,
  default: { asUser: () => ({ requestJira: mockRequestJira }) },
  // route bir template tag'dir; testte URL'yi düz string olarak birleştirmek yeterli.
  route: (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? values[i] : ''), ''),
}));

// Not: import'lar da dosyanın başına taşındığı için fabrika çalıştığında
// mockKvsGet/mockKvsSet henüz tanımlı değildir. Bu yüzden onlara doğrudan değil,
// çağrı anında erişen ok fonksiyonları üzerinden bağlanıyoruz.
jest.mock('@forge/kvs', () => {
  const store = {
    get: (...args) => mockKvsGet(...args),
    set: (...args) => mockKvsSet(...args),
  };
  return { __esModule: true, kvs: store, default: store };
});

import { handler } from './index.js';
import { DEFAULT_SETTINGS } from './rules.js';
import { ERROR_CODES } from './errors.js';

// Jira yanıtlarını taklit eden küçük yardımcı.
const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

const adminPermission = jsonResponse({ permissions: { ADMINISTER_PROJECTS: { havePermission: true } } });

const projectContext = { extension: { project: { id: '10001', key: 'ABC' } } };

// Proje ID'si olmayan, sadece proje anahtarını taşıyan bir context.
const keyOnlyContext = { extension: { project: { key: 'ABC' } } };

const issueContext = { extension: { issue: { id: '20001' } } };

// Resolver'lar hata fırlatmak yerine { ok: false, error: { code } } döner.
// Bu yardımcı, beklenen hata koduyla başarısız bir yanıt olduğunu doğrular.
const expectFailure = (result, code) => {
  expect(result.ok).toBe(false);
  expect(result.error.code).toBe(code);
};

beforeEach(() => {
  jest.resetAllMocks();
  // Beklenmeyen hatalar console.error ile loglanır; test çıktısını kirletmesin.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe('getSettings', () => {
  test('Ayarları proje ID anahtarından okur ve varsayılanlarla birleştirir', async () => {
    mockKvsGet.mockResolvedValue({ staleLimitDays: 7 });

    const result = await handler.getSettings({ context: projectContext });

    expect(mockKvsGet).toHaveBeenCalledTimes(1);
    expect(mockKvsGet).toHaveBeenCalledWith('settings-10001');
    expect(result).toEqual({ ok: true, data: { ...DEFAULT_SETTINGS, staleLimitDays: 7 } });
  });

  test('Kayıt yoksa varsayılanları döner', async () => {
    mockKvsGet.mockResolvedValue(undefined);
    expect(await handler.getSettings({ context: projectContext })).toEqual({ ok: true, data: DEFAULT_SETTINGS });
  });

  test("Context'te proje ID de key de yoksa Jira/KVS'ye gitmeden varsayılanları döner", async () => {
    const result = await handler.getSettings({ context: { extension: {} } });
    expect(result).toEqual({ ok: true, data: DEFAULT_SETTINGS });
    expect(mockRequestJira).not.toHaveBeenCalled();
    expect(mockKvsGet).not.toHaveBeenCalled();
  });

  test("Context'te sadece key varsa ID'yi /rest/api/3/project/{key} ile çözer", async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ id: '10001', key: 'ABC' }));
    mockKvsGet.mockResolvedValue({ labelsEnabled: true });

    const result = await handler.getSettings({ context: keyOnlyContext });

    expect(mockRequestJira).toHaveBeenCalledTimes(1);
    expect(mockRequestJira).toHaveBeenCalledWith('/rest/api/3/project/ABC');
    expect(mockKvsGet).toHaveBeenCalledWith('settings-10001');
    expect(result).toEqual({ ok: true, data: { ...DEFAULT_SETTINGS, labelsEnabled: true } });
  });

  test('Key ile ID çözümlenemezse varsayılanlara düşmez, NOT_FOUND döner', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({}, false, 404));
    const result = await handler.getSettings({ context: keyOnlyContext });
    expectFailure(result, ERROR_CODES.NOT_FOUND);
    expect(result.error.details).toEqual({ status: 404 });
    expect(mockKvsGet).not.toHaveBeenCalled();
  });

  test('Proje yanıtında id yoksa JIRA_ERROR döner', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ key: 'ABC' }));
    const result = await handler.getSettings({ context: keyOnlyContext });
    expectFailure(result, ERROR_CODES.JIRA_ERROR);
  });

  test('KVS hatası yakalanır: UNEXPECTED döner ve hata mesajı loglanmaz', async () => {
    mockKvsGet.mockRejectedValue(new TypeError('storage down for settings-10001'));

    const result = await handler.getSettings({ context: projectContext });

    expect(result).toEqual({ ok: false, error: { code: ERROR_CODES.UNEXPECTED } });
    // Sadece resolver adı ve hata türü loglanır, hata mesajı (içerik) loglanmaz.
    expect(console.error).toHaveBeenCalledWith('[getSettings] unexpected error: TypeError');
  });
});

describe('saveSettings', () => {
  test('Geçerli ayarları sadece proje ID anahtarına yazar', async () => {
    mockRequestJira.mockResolvedValue(adminPermission);
    const payload = { ...DEFAULT_SETTINGS, labelsEnabled: true, extra: 'drop-me' };

    const result = await handler.saveSettings({ context: projectContext, payload });

    expect(result).toEqual({ ok: true, data: { ...DEFAULT_SETTINGS, labelsEnabled: true } });
    expect(mockRequestJira.mock.calls[0][0]).toContain('projectId=10001');
    expect(mockKvsSet).toHaveBeenCalledTimes(1);
    expect(mockKvsSet).toHaveBeenCalledWith('settings-10001', { ...DEFAULT_SETTINGS, labelsEnabled: true });
  });

  test('Geçersiz ayarları reddeder, hataları details içinde döner ve hiçbir şey yazmaz', async () => {
    mockRequestJira.mockResolvedValue(adminPermission);
    const payload = { ...DEFAULT_SETTINGS, minDescriptionLength: 0 };

    const result = await handler.saveSettings({ context: projectContext, payload });

    expectFailure(result, ERROR_CODES.INVALID_SETTINGS);
    expect(result.error.details).toHaveLength(1);
    expect(result.error.details[0]).toBe('Minimum description length must be a whole number from 1 to 500.');
    expect(mockKvsSet).not.toHaveBeenCalled();
  });

  test('Proje yöneticisi olmayan kullanıcıyı reddeder', async () => {
    mockRequestJira.mockResolvedValue(
      jsonResponse({ permissions: { ADMINISTER_PROJECTS: { havePermission: false } } })
    );

    const result = await handler.saveSettings({ context: projectContext, payload: DEFAULT_SETTINGS });

    expectFailure(result, ERROR_CODES.NOT_PROJECT_ADMIN);
    expect(mockKvsSet).not.toHaveBeenCalled();
  });

  test.each([
    [401, ERROR_CODES.NO_PERMISSION],
    [403, ERROR_CODES.NO_PERMISSION],
    [500, ERROR_CODES.JIRA_ERROR],
  ])('Yetki isteği %p dönerse %s ile reddeder', async (status, code) => {
    mockRequestJira.mockResolvedValue(jsonResponse({}, false, status));
    const result = await handler.saveSettings({ context: projectContext, payload: DEFAULT_SETTINGS });
    expectFailure(result, code);
    expect(mockKvsSet).not.toHaveBeenCalled();
  });

  test("Context'te sadece key varsa çözülen ID ile yetki kontrolü yapar ve kaydeder", async () => {
    mockRequestJira
      .mockResolvedValueOnce(jsonResponse({ id: '10001', key: 'ABC' })) // GET /project/ABC
      .mockResolvedValueOnce(adminPermission); // GET /mypermissions

    const result = await handler.saveSettings({ context: keyOnlyContext, payload: DEFAULT_SETTINGS });

    expect(result.ok).toBe(true);
    expect(mockRequestJira.mock.calls[0][0]).toBe('/rest/api/3/project/ABC');
    expect(mockRequestJira.mock.calls[1][0]).toContain('projectId=10001');
    expect(mockKvsSet).toHaveBeenCalledWith('settings-10001', DEFAULT_SETTINGS);
  });

  test("Context'te proje ID de key de yoksa NO_PROJECT_CONTEXT döner", async () => {
    const result = await handler.saveSettings({ context: {}, payload: DEFAULT_SETTINGS });
    expectFailure(result, ERROR_CODES.NO_PROJECT_CONTEXT);
    expect(mockRequestJira).not.toHaveBeenCalled();
  });

  test('KVS yazma hatası yakalanır ve UNEXPECTED döner', async () => {
    mockRequestJira.mockResolvedValue(adminPermission);
    mockKvsSet.mockRejectedValue(new Error('write failed'));
    const result = await handler.saveSettings({ context: projectContext, payload: DEFAULT_SETTINGS });
    expectFailure(result, ERROR_CODES.UNEXPECTED);
  });
});

describe('getIssueHealth', () => {
  const issueFields = {
    project: { id: '10001', key: 'ABC' },
    status: { statusCategory: { key: 'done', name: 'Bitti' } },
    description: null,
    assignee: null,
    duedate: null,
    updated: new Date().toISOString(),
    labels: [],
  };

  test("Ayarları issue'nun proje ID anahtarından tek seferde okur", async () => {
    mockRequestJira.mockResolvedValue(
      jsonResponse({ fields: { ...issueFields, status: { statusCategory: { key: 'new' } } } })
    );
    mockKvsGet.mockResolvedValue(undefined);

    const result = await handler.getIssueHealth({ context: issueContext });

    expect(mockKvsGet).toHaveBeenCalledTimes(1);
    expect(mockKvsGet).toHaveBeenCalledWith('settings-10001');
    expect(result.ok).toBe(true);
    expect(result.data.score).toBe(25);
  });

  test('Sadece gereken alanları ister', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ fields: issueFields }));
    await handler.getIssueHealth({ context: issueContext });
    expect(mockRequestJira.mock.calls[0][0]).toBe(
      '/rest/api/3/issue/20001?fields=project,status,description,assignee,duedate,updated,labels'
    );
  });

  test('Statü kategorisi key değeri "done" ise isDone döner', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ fields: issueFields }));
    const result = await handler.getIssueHealth({ context: issueContext });
    expect(result).toEqual({ ok: true, data: { isDone: true } });
  });

  test("Done issue için KVS'den ayar okunmaz", async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ fields: issueFields }));
    await handler.getIssueHealth({ context: issueContext });
    expect(mockKvsGet).not.toHaveBeenCalled();
  });

  test('Issue ID yoksa NO_ISSUE_CONTEXT döner', async () => {
    const result = await handler.getIssueHealth({ context: {} });
    expectFailure(result, ERROR_CODES.NO_ISSUE_CONTEXT);
    expect(mockRequestJira).not.toHaveBeenCalled();
  });

  test.each([
    [401, ERROR_CODES.NO_PERMISSION],
    [403, ERROR_CODES.NO_PERMISSION],
    [404, ERROR_CODES.NOT_FOUND],
    [500, ERROR_CODES.JIRA_ERROR],
  ])('Jira %p dönerse %s döner ve log yazmaz', async (status, code) => {
    mockRequestJira.mockResolvedValue(jsonResponse({}, false, status));

    const result = await handler.getIssueHealth({ context: issueContext });

    expectFailure(result, code);
    expect(result.error.details).toEqual({ status });
    // Beklenen hatalar normal sonuçtur; forge logs'a ERROR yazılmaz.
    expect(console.error).not.toHaveBeenCalled();
  });

  test('Ağ hatası (requestJira reject) yakalanır ve UNEXPECTED döner', async () => {
    mockRequestJira.mockRejectedValue(new Error('socket hang up'));
    const result = await handler.getIssueHealth({ context: issueContext });
    expectFailure(result, ERROR_CODES.UNEXPECTED);
    expect(console.error).toHaveBeenCalledWith('[getIssueHealth] unexpected error: Error');
  });
});
