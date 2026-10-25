import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Box, Toggle, Textfield, Button, Stack, SectionMessage } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [descriptionEnabled, setDescriptionEnabled] = useState(true);
  const [minDescriptionLength, setMinDescriptionLength] = useState('30');
  const [assigneeEnabled, setAssigneeEnabled] = useState(true);
  const [dueDateEnabled, setDueDateEnabled] = useState(true);
  const [recentlyUpdatedEnabled, setRecentlyUpdatedEnabled] = useState(true);
  const [staleLimitDays, setStaleLimitDays] = useState('14');
  const [labelsEnabled, setLabelsEnabled] = useState(false);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    invoke('getSettings')
      .then((data) => {
        setDescriptionEnabled(Boolean(data.descriptionEnabled));
        setMinDescriptionLength(String(data.minDescriptionLength ?? 30));
        setAssigneeEnabled(Boolean(data.assigneeEnabled));
        setDueDateEnabled(Boolean(data.dueDateEnabled));
        setRecentlyUpdatedEnabled(Boolean(data.recentlyUpdatedEnabled));
        setStaleLimitDays(String(data.staleLimitDays ?? 14));
        setLabelsEnabled(Boolean(data.labelsEnabled));
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setStatus({ type: 'error', message: 'Ayarlar yüklenirken hata oluştu.' });
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setStatus(null);

    const descLen = Number(minDescriptionLength);
    const staleDays = Number(staleLimitDays);

    // R5 Gereksinimi: 1-500 ve 1-365 doğrulaması
    if (!Number.isInteger(descLen) || descLen < 1 || descLen > 500) {
      setStatus({ type: 'error', message: 'Minimum açıklama uzunluğu 1 ile 500 karakter arasında bir tam sayı olmalıdır.' });
      return;
    }

    if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 365) {
      setStatus({ type: 'error', message: 'Güncellenme sınırı (Stale limit) 1 ile 365 gün arasında bir tam sayı olmalıdır.' });
      return;
    }

    try {
      const newSettings = {
        descriptionEnabled,
        minDescriptionLength: descLen,
        assigneeEnabled,
        dueDateEnabled,
        recentlyUpdatedEnabled,
        staleLimitDays: staleDays,
        labelsEnabled,
      };

      await invoke('saveSettings', newSettings);
      setStatus({ type: 'success', message: 'Proje ayarları başarıyla kaydedildi!' });
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: `Kaydetme hatası: ${err.message}` });
    }
  };

  if (loading) {
    return <Text>Ayarlar yükleniyor...</Text>;
  }

  return (
    <Box padding="space.100">
      <Stack space="space.200">
        <Text>Bu projedeki görevlerin sağlık durumu için kuralları belirleyin.</Text>

        {status && (
          <SectionMessage appearance={status.type}>
            <Text>{status.message}</Text>
          </SectionMessage>
        )}

        <Stack space="space.150">
          <Box>
            <Text weight="bold">Description (Açıklama) Kontrolü</Text>
            <Toggle
              isChecked={descriptionEnabled}
              onChange={(e) => setDescriptionEnabled(e.target.checked)}
            />
            <Text>Minimum Karakter Sayısı (1 - 500):</Text>
            <Textfield
              value={minDescriptionLength}
              onChange={(e) => setMinDescriptionLength(e.target.value)}
            />
          </Box>

          <Box>
            <Text weight="bold">Assignee (Atanan Kişi) Kontrolü</Text>
            <Toggle
              isChecked={assigneeEnabled}
              onChange={(e) => setAssigneeEnabled(e.target.checked)}
            />
          </Box>

          <Box>
            <Text weight="bold">Due Date (Bitiş Tarihi) Kontrolü</Text>
            <Toggle
              isChecked={dueDateEnabled}
              onChange={(e) => setDueDateEnabled(e.target.checked)}
            />
          </Box>

          <Box>
            <Text weight="bold">Recently Updated Kontrolü</Text>
            <Toggle
              isChecked={recentlyUpdatedEnabled}
              onChange={(e) => setRecentlyUpdatedEnabled(e.target.checked)}
            />
            <Text>Kaç gün güncellenmezse uyarı versin? (1 - 365):</Text>
            <Textfield
              value={staleLimitDays}
              onChange={(e) => setStaleLimitDays(e.target.value)}
            />
          </Box>

          <Box>
            <Text weight="bold">Labels (Etiket) Kontrolü</Text>
            <Toggle
              isChecked={labelsEnabled}
              onChange={(e) => setLabelsEnabled(e.target.checked)}
            />
          </Box>

          <Button appearance="primary" onClick={handleSave}>
            Ayarları Kaydet
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);