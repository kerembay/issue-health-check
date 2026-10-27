export const DEFAULT_SETTINGS = {
  descriptionEnabled: true,
  minDescriptionLength: 30,
  assigneeEnabled: true,
  dueDateEnabled: true,
  recentlyUpdatedEnabled: true,
  staleLimitDays: 14,
  labelsEnabled: false,
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

export const evaluateIssueHealth = (issueData, settings) => {
  // R3: Görev "Done" statüsündeyse hesaplamayı durdur
  if (issueData.statusCategory === 'Done' || issueData.statusCategory === 'Bitti' || issueData.statusCategory === 'Tamamlandı') {
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
      results.push({ name: 'Description', passed: false, message: `Add at least ${settings.minDescriptionLength} characters to description (currently ${length}).` });
    }
  }

  if (settings.assigneeEnabled) {
    totalEnabled++;
    if (issueData.assignee !== null) {
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
      results.push({ name: 'Recently updated', passed: false, message: `Issue hasn't been updated in ${diffDays} days (limit is ${settings.staleLimitDays}).` });
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