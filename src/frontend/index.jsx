import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Box, Stack, Tag, Spinner, SectionMessage } from '@forge/react';
import { invoke } from '@forge/bridge';
import { getErrorMessage } from './errorMessages.js';

const App = () => {
  const [healthData, setHealthData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Resolver her zaman { ok, data } veya { ok: false, error: { code } } döner.
    // invoke'un kendisi reddedilirse (ör. ağ hatası) bunu da beklenmeyen hata sayarız.
    invoke('getIssueHealth')
      .then((result) => {
        if (result?.ok) {
          setHealthData(result.data);
        } else {
          setError(getErrorMessage(result?.error));
        }
      })
      .catch(() => setError(getErrorMessage(null)));
  }, []);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Sağlık durumu yüklenemedi">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (!healthData) {
    return <Spinner size="medium" label="Sağlık durumu yükleniyor" />;
  }

  // R3: Görev tamamlandıysa (Done)
  if (healthData.isDone) {
    return (
      <Box padding="space.100">
        <Text weight="bold">🎉 Done</Text>
        <Text>Görev tamamlandığı için sağlık kontrolüne gerek yok.</Text>
      </Box>
    );
  }

  // R3: Bütün kurallar kapalıysa
  if (healthData.noChecksEnabled) {
    return (
      <Box padding="space.100">
        <Text weight="bold">⚠️ Kapalı</Text>
        <Text>Proje ayarlarından tüm sağlık kontrolleri kapatılmış.</Text>
      </Box>
    );
  }

  const getBandColor = (band) => {
    switch (band) {
      case 'Healthy':
        return 'green';
      case 'Need attention':
        return 'yellow';
      case 'At risk':
        return 'red';
      default:
        return 'standard';
    }
  };

  return (
    <Box padding="space.100">
      <Stack space="space.100">
        <Text>Sağlık Puanı: {healthData.score}/100</Text>
        <Tag text={healthData.band} color={getBandColor(healthData.band)} />

        <Stack space="space.050">
          {healthData.results.map((result) => (
            <Text key={result.name}>
              {result.passed ? '✅' : '❌'} {result.name}: {result.message}
            </Text>
          ))}
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
