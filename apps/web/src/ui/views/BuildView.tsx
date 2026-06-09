import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { DownloadCloud, Hammer, Save, X } from "lucide-react";

import { BuildJobsPanel } from "./BuildJobsPanel";
import { BuildSettingsForm } from "./BuildSettingsForm";
import { BuildStartConfirmModal } from "./BuildStartConfirmModal";
import { useBuildView } from "./use-build-view";

export function BuildView() {
  const fm = useBuildView();

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="flex-end" align="flex-start" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Button
              aria-label="Pull llama.cpp repository"
              variant="default"
              leftSection={<DownloadCloud size={16} />}
              loading={fm.pullMutation.isPending}
              disabled={!fm.settingsReady || Boolean(fm.runningJob)}
              onClick={() => fm.pullMutation.mutate()}
            >
              Pull
            </Button>
            <Button
              aria-label="Save build settings"
              variant="light"
              leftSection={<Save size={16} />}
              loading={fm.saveMutation.isPending}
              disabled={!fm.settingsReady}
              onClick={() => fm.saveMutation.mutate()}
            >
              Save
            </Button>
            <Button
              aria-label="Open build start confirmation"
              leftSection={<Hammer size={16} />}
              loading={fm.startMutation.isPending}
              disabled={!fm.canStartJob}
              onClick={() => fm.setStartConfirmOpened(true)}
            >
              Start job
            </Button>
            <Button
              aria-label="Cancel running build job"
              variant="subtle"
              color="red"
              leftSection={<X size={16} />}
              disabled={!fm.runningJob}
              loading={fm.cancelMutation.isPending}
              onClick={() =>
                fm.runningJob && fm.cancelMutation.mutate(fm.runningJob.id)
              }
            >
              Cancel
            </Button>
          </Group>
        </Group>

        {!fm.selectedSteps.length && (
          <Text c="red" size="sm">
            Enable at least one build step before starting a job.
          </Text>
        )}

        {!fm.settingsReady && fm.settingsQuery.isLoading && (
          <Text c="dimmed" size="sm">
            Loading build settings from API...
          </Text>
        )}

        {!fm.settingsReady && fm.settingsQuery.isError && (
          <Text c="red" size="sm">
            {(fm.settingsQuery.error as Error).message}
          </Text>
        )}

        <BuildSettingsForm fm={fm} />
        <BuildJobsPanel fm={fm} />
      </Stack>

      <BuildStartConfirmModal fm={fm} />
    </Paper>
  );
}
