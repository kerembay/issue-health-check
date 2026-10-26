import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Box,
  Toggle,
  Textfield,
  LoadingButton,
  Stack,
  SectionMessage,
  Spinner,
  Label,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { ERROR_CODES } from '../errors.js';
import { validateSettings } from '../rules.js';
import { getErrorMessage } from './errorMessages.js';

const App = () => {
  const [descriptionEnabled, setDescriptionEnabled] = useState(true);
  const [minDescriptionLength, setMinDescriptionLength] = useState('30');
  const [assigneeEnabled, setAssigneeEnabled] = useState(true);
  const [dueDateEnabled, setDueDateEnabled] = useState(true);
  const [recentlyUpdatedEnabled, setRecentlyUpdatedEnabled] = useState(true);
  const [staleLimitDays, setStaleLimitDays] = useState('14');
  const [labelsEnabled, setLabelsEnabled] = useState(false);

  const [loading, setLoading] = useState(true);
  // Ayarlar yüklenemezse formu hiç göstermeyiz. Aksi halde form varsayılan
  // değerlerle açılır ve yönetici "Kaydet"e basarsa kayıtlı ayarların üzerine
  // varsayılanlar yazılırdı.
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    invoke('getSettings')
      .then((result) => {
        if (!result?.ok) {
          setLoadError(getErrorMessage(result?.error));
          return;
        }
        const data = result.data;
        setDescriptionEnabled(Boolean(data.descriptionEnabled));
        setMinDescriptionLength(String(data.minDescriptionLength ?? 30));
        setAssigneeEnabled(Boolean(data.assigneeEnabled));
        setDueDateEnabled(Boolean(data.dueDateEnabled));
        setRecentlyUpdatedEnabled(Boolean(data.recentlyUpdatedEnabled));
        setStaleLimitDays(String(data.staleLimitDays ?? 14));
        setLabelsEnabled(Boolean(data.labelsEnabled));
      })
      .catch(() => setLoadError(getErrorMessage(null)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setStatus(null);

    // Metin kutularındaki değerler string'dir; sayıya çeviriyoruz. Boş alan
    // Number('') = 0 olur ve bu yüzden aşağıdaki doğrulamada reddedilir.
    const input = {
      descriptionEnabled,
      minDescriptionLength: Number(minDescriptionLength),
      assigneeEnabled,
      dueDateEnabled,
      recentlyUpdatedEnabled,
      staleLimitDays: Number(staleLimitDays),
      labelsEnabled,
    };

    // R5: Backend'in kullandığı validateSettings fonksiyonunun aynısını burada da
    // çalıştırıyoruz; böylece iki tarafın kuralları (1-500, 1-365) hiçbir zaman
    // birbirinden ayrışmaz. Geçersizse hiçbir şey kaydetmeden hataları gösteririz.
    const { valid, errors, settings: newSettings } = validateSettings(input);
    if (!valid) {
      setStatus({ type: 'error', message: errors.join(' ') });
      return;
    }

    // Kaydetme sürerken buton "yükleniyor" durumunda kalır; böylece art arda
    // tıklamalar birden fazla kayıt isteği göndermez.
    setSaving(true);
    try {
      const result = await invoke('saveSettings', newSettings);
      if (result?.ok) {
        setStatus({ type: 'success', message: 'Proje ayarları başarıyla kaydedildi!' });
      } else if (result?.error?.code === ERROR_CODES.INVALID_SETTINGS && result.error.details?.length) {
        // Backend doğrulamasının ayrıntılı hatalarını da gösteriyoruz.
        setStatus({ type: 'error', message: `${getErrorMessage(result.error)} ${result.error.details.join(' ')}` });
      } else {
        setStatus({ type: 'error', message: getErrorMessage(result?.error) });
      }
    } catch {
      setStatus({ type: 'error', message: getErrorMessage(null) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Spinner size="medium" label="Ayarlar yükleniyor" />;
  }

  if (loadError) {
    return (
      <SectionMessage appearance="error" title="Ayarlar yüklenemedi">
        <Text>{loadError} Ayarlar yüklenmeden kaydetme yapılamaz.</Text>
      </SectionMessage>
    );
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
            <Label labelFor="descriptionEnabled">Description (Açıklama) Kontrolü</Label>
            <Toggle
              id="descriptionEnabled"
              isChecked={descriptionEnabled}
              onChange={(e) => setDescriptionEnabled(e.target.checked)}
            />
            <Label labelFor="minDescriptionLength">Minimum Karakter Sayısı (1 - 500)</Label>
            <Textfield
              id="minDescriptionLength"
              type="number"
              value={minDescriptionLength}
              onChange={(e) => setMinDescriptionLength(e.target.value)}
            />
          </Box>

          <Box>
            <Label labelFor="assigneeEnabled">Assignee (Atanan Kişi) Kontrolü</Label>
            <Toggle
              id="assigneeEnabled"
              isChecked={assigneeEnabled}
              onChange={(e) => setAssigneeEnabled(e.target.checked)}
            />
          </Box>

          <Box>
            <Label labelFor="dueDateEnabled">Due Date (Bitiş Tarihi) Kontrolü</Label>
            <Toggle
              id="dueDateEnabled"
              isChecked={dueDateEnabled}
              onChange={(e) => setDueDateEnabled(e.target.checked)}
            />
          </Box>

          <Box>
            <Label labelFor="recentlyUpdatedEnabled">Recently Updated Kontrolü</Label>
            <Toggle
              id="recentlyUpdatedEnabled"
              isChecked={recentlyUpdatedEnabled}
              onChange={(e) => setRecentlyUpdatedEnabled(e.target.checked)}
            />
            <Label labelFor="staleLimitDays">Kaç gün güncellenmezse uyarı versin? (1 - 365)</Label>
            <Textfield
              id="staleLimitDays"
              type="number"
              value={staleLimitDays}
              onChange={(e) => setStaleLimitDays(e.target.value)}
            />
          </Box>

          <Box>
            <Label labelFor="labelsEnabled">Labels (Etiket) Kontrolü</Label>
            <Toggle id="labelsEnabled" isChecked={labelsEnabled} onChange={(e) => setLabelsEnabled(e.target.checked)} />
          </Box>

          <LoadingButton appearance="primary" isLoading={saving} onClick={handleSave}>
            Ayarları Kaydet
          </LoadingButton>
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
