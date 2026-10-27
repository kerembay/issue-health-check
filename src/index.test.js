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

// Jira yanıtlarını taklit eden küçük yardımcı.
const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

const adminPermission = jsonResponse({ permissions: { ADMINISTER_PROJECTS: { havePermission: true } } });

const projectContext = { extension: { project: { id: '10001', key: 'ABC' } } };

// Proje ID'si olmayan, sadece proje anahtarını taşıyan bir context.
const keyOnlyContext = { extension: { project: { key: 'ABC' } } };

beforeEach(() => {
  jest.resetAllMocks();
});

describe('getSettings', () => {
  test('Ayarları proje ID anahtarından okur ve varsayılanlarla birleştirir', async () => {
    mockKvsGet.mockResolvedValue({ staleLimitDays: 7 });

    const result = await handler.getSettings({ context: projectContext });

    expect(mockKvsGet).toHaveBeenCalledTimes(1);
    expect(mockKvsGet).toHaveBeenCalledWith('settings-10001');
    expect(result).toEqual({ ...DEFAULT_SETTINGS, staleLimitDays: 7 });
  });

  test('Kayıt yoksa varsayılanları döner', async () => {
    mockKvsGet.mockResolvedValue(undefined);
    expect(await handler.getSettings({ context: projectContext })).toEqual(DEFAULT_SETTINGS);
  });

  test('Context\'te proje ID de key de yoksa Jira/KVS\'ye gitmeden varsayılanları döner', async () => {
    const result = await handler.getSettings({ context: { extension: {} } });
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(mockRequestJira).not.toHaveBeenCalled();
    expect(mockKvsGet).not.toHaveBeenCalled();
  });

  test('Context\'te sadece key varsa ID\'yi /rest/api/3/project/{key} ile çözer', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ id: '10001', key: 'ABC' }));
    mockKvsGet.mockResolvedValue({ labelsEnabled: true });

    const result = await handler.getSettings({ context: keyOnlyContext });

    expect(mockRequestJira).toHaveBeenCalledTimes(1);
    expect(mockRequestJira).toHaveBeenCalledWith('/rest/api/3/project/ABC');
    expect(mockKvsGet).toHaveBeenCalledWith('settings-10001');
    expect(result).toEqual({ ...DEFAULT_SETTINGS, labelsEnabled: true });
  });

  test('Key ile ID çözümlenemezse varsayılanlara düşmez, hata verir', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({}, false, 404));
    await expect(handler.getSettings({ context: keyOnlyContext })).rejects.toThrow(
      "Proje ID'si çözümlenemedi (ABC): 404"
    );
    expect(mockKvsGet).not.toHaveBeenCalled();
  });

  test('Proje yanıtında id yoksa hata verir', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ key: 'ABC' }));
    await expect(handler.getSettings({ context: keyOnlyContext })).rejects.toThrow('yanıtta id yok');
  });
});

describe('saveSettings', () => {
  test('Geçerli ayarları sadece proje ID anahtarına yazar', async () => {
    mockRequestJira.mockResolvedValue(adminPermission);
    const payload = { ...DEFAULT_SETTINGS, labelsEnabled: true, extra: 'drop-me' };

    await expect(handler.saveSettings({ context: projectContext, payload })).resolves.toBe(true);

    expect(mockRequestJira.mock.calls[0][0]).toContain('projectId=10001');
    expect(mockKvsSet).toHaveBeenCalledTimes(1);
    expect(mockKvsSet).toHaveBeenCalledWith('settings-10001', { ...DEFAULT_SETTINGS, labelsEnabled: true });
  });

  test('Geçersiz ayarları reddeder ve hiçbir şey yazmaz', async () => {
    mockRequestJira.mockResolvedValue(adminPermission);
    const payload = { ...DEFAULT_SETTINGS, minDescriptionLength: 0 };

    await expect(handler.saveSettings({ context: projectContext, payload })).rejects.toThrow('Geçersiz ayarlar');
    expect(mockKvsSet).not.toHaveBeenCalled();
  });

  test('Proje yöneticisi olmayan kullanıcıyı reddeder', async () => {
    mockRequestJira.mockResolvedValue(
      jsonResponse({ permissions: { ADMINISTER_PROJECTS: { havePermission: false } } })
    );

    await expect(handler.saveSettings({ context: projectContext, payload: DEFAULT_SETTINGS })).rejects.toThrow(
      'Erişim reddedildi'
    );
    expect(mockKvsSet).not.toHaveBeenCalled();
  });

  test('Yetki isteği başarısız olursa reddeder', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({}, false, 500));
    await expect(handler.saveSettings({ context: projectContext, payload: DEFAULT_SETTINGS })).rejects.toThrow(
      'Yetki doğrulanamadı'
    );
  });

  test('Context\'te sadece key varsa çözülen ID ile yetki kontrolü yapar ve kaydeder', async () => {
    mockRequestJira
      .mockResolvedValueOnce(jsonResponse({ id: '10001', key: 'ABC' })) // GET /project/ABC
      .mockResolvedValueOnce(adminPermission); // GET /mypermissions

    await expect(handler.saveSettings({ context: keyOnlyContext, payload: DEFAULT_SETTINGS })).resolves.toBe(true);

    expect(mockRequestJira.mock.calls[0][0]).toBe('/rest/api/3/project/ABC');
    expect(mockRequestJira.mock.calls[1][0]).toContain('projectId=10001');
    expect(mockKvsSet).toHaveBeenCalledWith('settings-10001', DEFAULT_SETTINGS);
  });

  test('Context\'te proje ID de key de yoksa hata verir', async () => {
    await expect(handler.saveSettings({ context: {}, payload: DEFAULT_SETTINGS })).rejects.toThrow(
      'Project ID or key not found'
    );
    expect(mockRequestJira).not.toHaveBeenCalled();
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

  test('Ayarları issue\'nun proje ID anahtarından tek seferde okur', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ fields: { ...issueFields, status: { statusCategory: { key: 'new' } } } }));
    mockKvsGet.mockResolvedValue(undefined);

    const result = await handler.getIssueHealth({ context: { extension: { issue: { id: '20001' } } } });

    expect(mockKvsGet).toHaveBeenCalledTimes(1);
    expect(mockKvsGet).toHaveBeenCalledWith('settings-10001');
    expect(result.score).toBe(25);
  });

  test('Statü kategorisi key\'i "done" ise isDone döner', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({ fields: issueFields }));
    const result = await handler.getIssueHealth({ context: { extension: { issue: { id: '20001' } } } });
    expect(result).toEqual({ isDone: true });
  });

  test('Issue ID yoksa hata verir', async () => {
    await expect(handler.getIssueHealth({ context: {} })).rejects.toThrow('Issue ID not found');
  });

  test('Jira isteği başarısız olursa hata verir', async () => {
    mockRequestJira.mockResolvedValue(jsonResponse({}, false, 404));
    await expect(
      handler.getIssueHealth({ context: { extension: { issue: { id: '20001' } } } })
    ).rejects.toThrow('Failed to load issue data: 404');
  });
});
