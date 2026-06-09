import type {
  LlamaArgumentDefault,
  LlamaArgumentOption,
} from "@llama-manager/core";
import {
  ActionIcon,
  Alert,
  Badge,
  Code,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { AlertTriangle, Copy } from "lucide-react";

import { ArgumentValueControl } from "../components/ArgumentValueControl";
import { EngineeringMarkdown } from "../components/EngineeringMarkdown";
import { argumentDefaultFromOption } from "../utils/argument-defaults";
import { formatLocalDateTime } from "../utils/time";
import {
  canUseAsDefault,
  defaultDraftKey,
  defaultNeedsValue,
  presetSupportColor,
  presetSupportLabel,
  sourceColor,
} from "./arguments-view-helpers";
import { type ArgumentsViewController } from "./use-arguments-view";

function ArgumentBadges(props: { option: LlamaArgumentOption }) {
  return (
    <Group gap={6} wrap="wrap">
      <Badge variant="light">{props.option.category}</Badge>
      <Badge variant="outline">{props.option.valueType}</Badge>
      {props.option.valueHint && (
        <Badge
          className="argument-value-hint"
          title={props.option.valueHint}
          variant="outline"
        >
          {props.option.valueHint}
        </Badge>
      )}
      <Badge color={sourceColor(props.option.helpRuSource)} variant="outline">
        {props.option.helpRuSource}
      </Badge>
      {props.option.control.presetSupport !== "supported" && (
        <Badge
          color={presetSupportColor(props.option.control.presetSupport)}
          variant="light"
        >
          {presetSupportLabel(props.option.control.presetSupport)}
        </Badge>
      )}
      {props.option.deprecated && (
        <Badge color="red" variant="light">
          deprecated
        </Badge>
      )}
    </Group>
  );
}

function ArgumentNames(props: { option: LlamaArgumentOption }) {
  return (
    <Group gap={6} wrap="wrap">
      {props.option.names.map((name) => (
        <Code key={name}>{name}</Code>
      ))}
    </Group>
  );
}

function DefaultScopeControl(props: {
  fm: ArgumentsViewController;
  scope: "instance" | "preset";
  label: string;
  current: LlamaArgumentDefault | null;
}) {
  const { fm, scope, label, current } = props;
  const selectedOption = fm.selectedOption;
  if (!selectedOption) {
    return null;
  }
  if (!canUseAsDefault(selectedOption, scope)) {
    return null;
  }
  const suggested = argumentDefaultFromOption(selectedOption, scope);
  const value = current?.value ?? suggested.value;
  const valueType = current?.valueType ?? suggested.valueType;
  const needsValue = defaultNeedsValue(valueType);
  const draftKey = defaultDraftKey(scope, suggested.key);
  const draftValue = fm.defaultValueDrafts[draftKey] ?? value;
  const commitOnChange =
    selectedOption.valueType === "boolean" ||
    (selectedOption.valueType === "enum" &&
      selectedOption.allowedValues.length > 0);

  function setDraftValue(nextValue: string) {
    fm.setDefaultValueDrafts((drafts) => ({
      ...drafts,
      [draftKey]: nextValue,
    }));
  }

  function commitValue(nextValue: string) {
    if (!current) {
      return;
    }
    fm.saveArgumentDefault(scope, true, {
      value: nextValue,
      valueType,
    });
  }

  return (
    <Group align="center" gap="xs" wrap="wrap">
      <Switch
        label={label}
        checked={Boolean(current)}
        disabled={fm.defaultsMutation.isPending}
        onChange={(event) =>
          fm.saveArgumentDefault(scope, event.currentTarget.checked, {
            value: draftValue,
            valueType,
          })
        }
      />
      {needsValue && (
        <ArgumentValueControl
          key={`${scope}-${selectedOption.primaryName}`}
          option={selectedOption}
          scope={scope}
          ariaLabel={`${label} default value`}
          value={draftValue}
          allowEmpty
          disabled={fm.defaultsMutation.isPending}
          size="xs"
          style={{ flex: "1 1 180px", minWidth: 160 }}
          onChange={(nextValue) => {
            setDraftValue(nextValue);
            if (commitOnChange) {
              commitValue(nextValue);
            }
          }}
          onBlur={(nextValue) => {
            if (!commitOnChange) {
              commitValue(nextValue);
            }
          }}
        />
      )}
    </Group>
  );
}

export function ArgumentDetailPanel({ fm }: { fm: ArgumentsViewController }) {
  const selectedOption = fm.selectedOption;
  return (
    <Paper withBorder p="md" radius="sm" className="args-reference-detail">
      {selectedOption ? (
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div className="argument-name">
              <Title order={4}>{selectedOption.primaryName}</Title>
              <Text c="dimmed" size="sm">
                {selectedOption.valueHint || "No explicit value hint"}
              </Text>
            </div>
            <Tooltip label="Copy argument name">
              <ActionIcon
                aria-label="Copy argument name"
                variant="subtle"
                onClick={fm.copyArgumentName}
              >
                <Copy size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <ArgumentBadges option={selectedOption} />

          <Stack gap={4}>
            <Text c="dimmed" size="xs">
              Names
            </Text>
            <ArgumentNames option={selectedOption} />
          </Stack>

          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Text fw={600} size="sm">
                    Defaults
                  </Text>
                  <Text c="dimmed" size="xs">
                    Pre-list this argument in new instances and in the model
                    preset editor so it is one toggle away.
                  </Text>
                </div>
                {fm.argumentDefaults.updatedAt && (
                  <Text c="dimmed" size="xs">
                    Updated {formatLocalDateTime(fm.argumentDefaults.updatedAt)}
                  </Text>
                )}
              </Group>
              <DefaultScopeControl
                fm={fm}
                scope="instance"
                label="New instance"
                current={fm.selectedInstanceDefault}
              />
              <DefaultScopeControl
                fm={fm}
                scope="preset"
                label="New model preset"
                current={fm.selectedPresetDefault}
              />
              {fm.selectedDefaultUnavailableMessage && (
                <Text c="dimmed" size="xs">
                  {fm.selectedDefaultUnavailableMessage}
                </Text>
              )}
            </Stack>
          </Paper>

          {selectedOption.env.length > 0 && (
            <Stack gap={4}>
              <Text c="dimmed" size="xs">
                Environment
              </Text>
              <Group gap={6} wrap="wrap">
                {selectedOption.env.map((env) => (
                  <Code key={env}>{env}</Code>
                ))}
              </Group>
            </Stack>
          )}

          <Stack gap={4}>
            <Text fw={600} size="sm">
              Short help
            </Text>
            <Text className="text-wrap" size="sm">
              {selectedOption.helpRu}
            </Text>
          </Stack>

          <details className="argument-secondary-details">
            <Text component="summary" fw={600} size="sm">
              Original --help, values and notes
            </Text>
            <Stack gap="xs" mt="xs">
              <Text c="dimmed" className="text-wrap" size="sm">
                {selectedOption.help}
              </Text>

              {selectedOption.allowedValues.length > 0 && (
                <Stack gap={4}>
                  <Text c="dimmed" size="xs">
                    Allowed values
                  </Text>
                  <Group gap={6} wrap="wrap">
                    {selectedOption.allowedValues.map((value) => (
                      <Code key={value}>{value}</Code>
                    ))}
                  </Group>
                </Stack>
              )}

              {selectedOption.notes && (
                <Stack gap={4}>
                  <Text c="dimmed" size="xs">
                    Notes
                  </Text>
                  <Text c="dimmed" className="text-wrap" size="sm">
                    {selectedOption.notes}
                  </Text>
                </Stack>
              )}
            </Stack>
          </details>

          <Divider />

          <Stack gap="xs">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Text fw={600} size="sm">
                Engineering help
              </Text>
            </Group>

            {fm.selectedDocQuery.isFetching && (
              <Text c="dimmed" size="sm">
                Loading engineering documentation...
              </Text>
            )}

            {fm.selectedDocQuery.isError && (
              <Alert
                color="red"
                icon={<AlertTriangle size={16} />}
                variant="light"
              >
                {(fm.selectedDocQuery.error as Error).message}
              </Alert>
            )}

            {fm.selectedDoc && fm.selectedDoc.exists ? (
              <Stack gap="xs">
                <ScrollArea h={520} type="auto" offsetScrollbars>
                  <EngineeringMarkdown
                    markdown={fm.visibleEngineeringMarkdown}
                  />
                </ScrollArea>
              </Stack>
            ) : (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap={4}>
                  <Text fw={600} size="sm">
                    Documentation file is missing
                  </Text>
                  <Text c="dimmed" size="sm">
                    Create this Markdown file and refresh the page. Agents can
                    work on it independently from the application code.
                  </Text>
                </Stack>
              </Paper>
            )}
          </Stack>
        </Stack>
      ) : (
        <Text c="dimmed" ta="center">
          Select an argument to view help
        </Text>
      )}
    </Paper>
  );
}
