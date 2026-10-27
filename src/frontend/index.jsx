import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Box, Stack, Tag } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [healthData, setHealthData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('getIssueHealth')
      .then(setHealthData)
      .catch((err) => {
        console.error(err);
        setError(err.message || 'Sağlık verisi yüklenirken hata oluştu.');
      });
  }, []);

  if (error) {
    return <Text>Hata: {error}</Text>;
  }

  if (!healthData) {
    return <Text>Sağlık durumu yükleniyor...</Text>;
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
          {healthData.results.map((result, index) => (
            <Text key={index}>
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
