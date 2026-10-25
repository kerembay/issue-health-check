import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import kvsDefault, { kvs as kvsNamed } from '@forge/kvs';
import { evaluateIssueHealth, extractTextFromAdf, DEFAULT_SETTINGS } from './rules.js';

const kvs = kvsNamed || kvsDefault;
const resolver = new Resolver();

const getProjectKeyOrId = (req) => {
  return (
    req.context?.extension?.project?.id ||
    req.context?.extension?.project?.key ||
    req.context?.extension?.issue?.project?.id ||
    req.context?.extension?.issue?.project?.key
  );
};

resolver.define('getSettings', async (req) => {
  const projectId = getProjectKeyOrId(req);
  if (!projectId) return DEFAULT_SETTINGS;

  const savedSettings = await kvs.get(`settings-${projectId}`);
  return savedSettings ? { ...DEFAULT_SETTINGS, ...savedSettings } : DEFAULT_SETTINGS;
});

resolver.define('saveSettings', async (req) => {
  const projectId = getProjectKeyOrId(req);
  const projectKey = req.context?.extension?.project?.key;

  if (!projectId) throw new Error('Project ID not found in context.');

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

  const newSettings = req.payload;
  
  await kvs.set(`settings-${projectId}`, newSettings);
  if (projectKey && projectKey !== projectId) {
    await kvs.set(`settings-${projectKey}`, newSettings);
  }
  
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
    statusCategory: fields.status?.statusCategory?.name || fields.status?.name || '',
    descriptionText: descriptionText,
    assignee: fields.assignee,
    dueDate: fields.duedate || null,
    updated: fields.updated,
    labels: fields.labels || [],
  };

  const apiProjectId = fields.project?.id;
  const apiProjectKey = fields.project?.key;
  const contextProjectId = getProjectKeyOrId(req);

  let savedSettings = null;
  if (apiProjectId) savedSettings = await kvs.get(`settings-${apiProjectId}`);
  if (!savedSettings && apiProjectKey) savedSettings = await kvs.get(`settings-${apiProjectKey}`);
  if (!savedSettings && contextProjectId) savedSettings = await kvs.get(`settings-${contextProjectId}`);

  const currentSettings = savedSettings ? { ...DEFAULT_SETTINGS, ...savedSettings } : DEFAULT_SETTINGS;

  return evaluateIssueHealth(issueData, currentSettings);
});

export const handler = resolver.getDefinitions();