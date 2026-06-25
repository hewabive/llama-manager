import {
  Box,
  Button,
  Group,
  JsonInput,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { Triangle } from "lucide-react";

import { InstanceFormArgumentsSection } from "./InstanceFormArgumentsSection";
import { InstanceFormCudaSection } from "./InstanceFormCudaSection";
import { InstanceFormMemorySection } from "./InstanceFormMemorySection";
import { InstanceFormModelSection } from "./InstanceFormModelSection";
import { InstanceFormNumaSection } from "./InstanceFormNumaSection";
import { InstanceFormPreflightSection } from "./InstanceFormPreflightSection";
import { InstanceFormRpcWorkersSection } from "./InstanceFormRpcWorkersSection";
import { InstanceFormSpecSection } from "./InstanceFormSpecSection";
import { TouchSelect } from "./TouchCombobox";
import {
  useInstanceForm,
  type InstanceFormModalProps,
} from "./use-instance-form";

export function InstanceFormModal(props: InstanceFormModalProps) {
  const fm = useInstanceForm(props);

  if (fm.waitingForInitialDefaults) {
    return (
      <Modal
        opened={props.opened}
        onClose={props.onClose}
        title={fm.modalTitle}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Text c="dimmed" size="sm">
          Loading default arguments...
        </Text>
      </Modal>
    );
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={fm.modalTitle}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={fm.form.onSubmit(fm.submit)}>
        <Stack gap="sm">
          <SegmentedControl
            fullWidth
            value={fm.kind}
            onChange={(value) => fm.setKind(value as typeof fm.kind)}
            disabled={fm.isEdit}
            data={[
              { label: "llama-server", value: "llama-server" },
              { label: "rpc-worker", value: "rpc-worker" },
            ]}
          />
          <TextInput
            label="Name"
            required
            description="Used as the config file name: letters, digits, dot, underscore, hyphen"
            {...fm.form.getInputProps("name")}
          />
          <TouchSelect
            label="Binary"
            required
            description="Managed in the Path catalog page; the working directory defaults to the binary's folder."
            placeholder={
              fm.pathCatalogQuery.isFetching
                ? "Loading catalog..."
                : "Select a binary from the catalog"
            }
            searchable
            value={fm.selectedBinaryPathRefId}
            onChange={fm.applyBinaryPathRef}
            data={fm.binaryCatalogOptions}
            nothingFoundMessage="No binaries in catalog"
          />
          {!fm.pathCatalogQuery.isFetching &&
            fm.binaryCatalogOptions.length === 0 && (
              <Text c="yellow" size="xs">
                No binaries in the catalog yet. Add one on the Path catalog page
                or build llama.cpp first.
              </Text>
            )}
          {!fm.isWorker && (
            <>
              <InstanceFormModelSection fm={fm} />
              <InstanceFormSpecSection fm={fm} />
              <InstanceFormRpcWorkersSection fm={fm} />
            </>
          )}
          <InstanceFormArgumentsSection fm={fm} />
          <InstanceFormPreflightSection fm={fm} />
          <InstanceFormCudaSection fm={fm} />
          <InstanceFormNumaSection fm={fm} />
          <InstanceFormMemorySection fm={fm} />
          <JsonInput
            label="Environment"
            minRows={4}
            formatOnBlur
            {...fm.form.getInputProps("envJson")}
          />
          <Group justify="space-between" mt="sm">
            <Box>
              {!fm.isEdit && (
                <Switch
                  label="Start after create"
                  checked={fm.startAfterCreate}
                  disabled={fm.mutation.isPending}
                  onChange={(event) =>
                    fm.setStartAfterCreate(event.currentTarget.checked)
                  }
                />
              )}
            </Box>
            <Group gap="xs">
              <Button
                variant="subtle"
                onClick={props.onClose}
                disabled={fm.mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={fm.mutation.isPending}
                leftSection={
                  !fm.isEdit && fm.startAfterCreate ? (
                    <Triangle size={16} fill="currentColor" />
                  ) : undefined
                }
              >
                {fm.isEdit
                  ? "Save"
                  : fm.startAfterCreate
                    ? "Create & Start"
                    : "Create"}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
