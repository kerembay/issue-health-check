import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Box, Stack, Lozenge, Spinner, SectionMessage } from '@forge/react';
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
      <SectionMessage appearance="error" title="Couldn't load issue health">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (!healthData) {
    return <Spinner size="medium" label="Loading issue health" />;
  }

  // R3: Görev tamamlandıysa (Done)
  if (healthData.isDone) {
    return (
      <Box padding="space.100">
        <Text weight="bold">🎉 Done</Text>
        <Text>This issue is done, so no health score is calculated.</Text>
      </Box>
    );
  }

  // R3: Bütün kurallar kapalıysa
  if (healthData.noChecksEnabled) {
    return (
      <Box padding="space.100">
        <Text weight="bold">⚠️ No checks enabled</Text>
        <Text>All health checks are turned off in this project's settings.</Text>
      </Box>
    );
  }

  // Bant adını UI Kit Lozenge görünümüne çevirir: yeşil, sarı veya kırmızı.
  const getBandAppearance = (band) => {
    switch (band) {
      case 'Healthy':
        return 'success';
      case 'Need attention':
        return 'moved';
      case 'At risk':
        return 'removed';
      default:
        return 'default';
    }
  };

  return (
    <Box padding="space.100">
      <Stack space="space.100">
        <Text>Health score: {healthData.score}/100</Text>
        <Lozenge appearance={getBandAppearance(healthData.band)} isBold>
          {healthData.band}
        </Lozenge>

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
