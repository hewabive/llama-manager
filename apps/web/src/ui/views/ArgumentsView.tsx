import {
  Alert,
  Badge,
  Group,
  Paper,
  Select,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { AlertTriangle } from "lucide-react";

import { TouchSelect } from "../components/TouchCombobox";
import { ArgumentDetailPanel } from "./ArgumentDetailPanel";
import { ArgumentReferenceList } from "./ArgumentReferenceList";
import { SourceSyncPanel } from "./ArgumentSourceSyncPanel";
import { allFilterValue } from "./arguments-view-helpers";
import { useArgumentsView } from "./use-arguments-view";

export function ArgumentsView() {
  const fm = useArgumentsView();

  return (
    <Stack gap="md">
      {fm.argsCatalogQuery.isError && (
        <Alert color="red" icon={<AlertTriangle size={18} />} variant="light">
          {(fm.argsCatalogQuery.error as Error).message}
        </Alert>
      )}

      {fm.argsCatalog && (
        <SourceSyncPanel
          report={fm.docsSyncQuery.data?.data}
          error={
            fm.docsSyncQuery.isError ? (fm.docsSyncQuery.error as Error) : null
          }
        />
      )}

      <Paper withBorder p="md" radius="sm">
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Group className="args-filter-controls" align="flex-end" gap="xs">
            <TextInput
              aria-label="Search arguments"
              label="Search"
              placeholder="name, category, help, env"
              value={fm.search}
              onChange={(event) => fm.setSearch(event.currentTarget.value)}
              className="search-input"
            />
            <TouchSelect
              aria-label="Argument category"
              label="Category"
              data={[
                { value: allFilterValue, label: "All categories" },
                ...fm.categories.map((item) => ({ value: item, label: item })),
              ]}
              value={fm.category}
              allowDeselect={false}
              searchable
              onChange={(value) => fm.setCategory(value ?? allFilterValue)}
              w={220}
            />
            <Select
              aria-label="Argument type"
              label="Type"
              data={[
                { value: allFilterValue, label: "All types" },
                ...fm.valueTypes.map((item) => ({ value: item, label: item })),
              ]}
              value={fm.valueType}
              allowDeselect={false}
              onChange={(value) => fm.setValueType(value ?? allFilterValue)}
              w={150}
            />
          </Group>
          <Group gap="lg" pb={4} wrap="wrap">
            <Switch
              label="Deprecated"
              checked={fm.showDeprecated}
              onChange={(event) =>
                fm.setShowDeprecated(event.currentTarget.checked)
              }
            />
            <Badge variant="light">
              {fm.filteredOptions.length}/{fm.options.length}
            </Badge>
          </Group>
        </Group>
      </Paper>

      <div className="args-reference-layout">
        <ArgumentReferenceList fm={fm} />
        <ArgumentDetailPanel fm={fm} />
      </div>
    </Stack>
  );
}
