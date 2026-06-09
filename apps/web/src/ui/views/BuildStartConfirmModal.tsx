import { Badge, Button, Code, Group, Modal, Stack, Text } from "@mantine/core";
import { AlertTriangle, Hammer } from "lucide-react";

import { type BuildViewController } from "./use-build-view";

export function BuildStartConfirmModal({ fm }: { fm: BuildViewController }) {
  return (
    <Modal
      opened={fm.startConfirmOpened}
      onClose={() => fm.setStartConfirmOpened(false)}
      title="Start build job"
      centered
    >
      <Stack gap="sm">
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <AlertTriangle size={18} />
          <Text size="sm">
            This can run git, npm, CMake and compiler processes for a long time.
            If cleaning is enabled, the build directory will be removed before
            CMake runs.
          </Text>
        </Group>
        <Stack gap={4}>
          {fm.selectedSteps.map((step) => (
            <Badge key={step} variant="outline">
              {step}
            </Badge>
          ))}
        </Stack>
        <Code className="code-wrap">{fm.repoPath}</Code>
        <Code className="code-wrap">{fm.effectiveBuildDir}</Code>
        <Group justify="flex-end" gap="xs">
          <Button
            variant="default"
            onClick={() => fm.setStartConfirmOpened(false)}
          >
            Cancel
          </Button>
          <Button
            leftSection={<Hammer size={16} />}
            loading={fm.startMutation.isPending}
            disabled={!fm.canStartJob}
            onClick={() => fm.startMutation.mutate()}
          >
            Start job
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
