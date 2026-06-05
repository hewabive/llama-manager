import type { LlamaArgumentDefault } from "@llama-manager/core";
import { ActionIcon, Group, Stack, Text, Tooltip } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";

import { ArgumentPicker } from "../../components/ArgumentPicker";
import { ArgumentRow } from "../../components/ArgumentRow";
import { presetKeyFromArgument } from "../../components/PresetArguments";
import { defaultArgumentValue } from "../../utils/argument-defaults";
import { normalizePresetArgKey } from "../../utils/preset-args";
import { useArgsCatalog } from "./useArgsCatalog";

const structuredArgKeys = new Set(["model", "m", "mmproj", "mm"]);

const noPresetDefaults: LlamaArgumentDefault[] = [];

export function PresetArgsEditor(props: {
  extraArgs: Record<string, string>;
  presetDefaults?: LlamaArgumentDefault[];
  label?: string;
  emptyHint?: string;
  onChange: (next: Record<string, string>) => void;
}) {
  const catalog = useArgsCatalog();
  const presetDefaults = props.presetDefaults ?? noPresetDefaults;

  const overlay = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; value: string }[] = [];
    for (const item of presetDefaults) {
      const key = normalizePresetArgKey(item.key);
      if (!key || structuredArgKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({ key, value: item.value });
    }
    return out;
  }, [presetDefaults]);

  const overlayKeys = new Set(overlay.map((item) => item.key));
  const slots = [
    ...overlay.map((item) => {
      const active = item.key in props.extraArgs;
      return {
        key: item.key,
        isDefault: true,
        active,
        value: active ? props.extraArgs[item.key]! : item.value,
      };
    }),
    ...Object.keys(props.extraArgs)
      .filter((key) => !overlayKeys.has(key))
      .map((key) => ({
        key,
        isDefault: false,
        active: true,
        value: props.extraArgs[key]!,
      })),
  ];
  const presentKeys = new Set(slots.map((slot) => slot.key));

  function setValue(key: string, value: string) {
    props.onChange({ ...props.extraArgs, [key]: value });
  }
  function setActive(key: string, value: string, active: boolean) {
    const next = { ...props.extraArgs };
    if (active) {
      next[key] = value;
    } else {
      delete next[key];
    }
    props.onChange(next);
  }
  function remove(key: string) {
    const next = { ...props.extraArgs };
    delete next[key];
    props.onChange(next);
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          {props.label ?? "Arguments"}
        </Text>
        <Tooltip label="Reload from llama-server --help">
          <ActionIcon
            aria-label="Reload args catalog"
            variant="subtle"
            loading={Boolean(catalog.isFetching || catalog.refreshing)}
            onClick={catalog.refresh}
          >
            <RefreshCw size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <ArgumentPicker
        isError={catalog.isError}
        isFetching={catalog.isFetching}
        errorPlaceholder="Unable to read --help from llama-server binary"
        data={catalog.selectablePresetArgs.map((option) => {
          const key = presetKeyFromArgument(option);
          const aliases = option.names.filter(
            (name) => name !== option.primaryName,
          );
          const nameLabel = aliases.length
            ? `${key}, ${aliases.join(", ")}`
            : key;
          return {
            value: key,
            label: `${nameLabel}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}`,
            disabled:
              presentKeys.has(key) || !option.compatibility.presentInBinary,
            searchTerms: [key, option.primaryName, ...option.names],
          };
        })}
        onPick={(value) => {
          const option = catalog.knownArgByPresetKey.get(value);
          if (option) {
            setValue(
              presetKeyFromArgument(option),
              defaultArgumentValue(option, "preset"),
            );
          }
        }}
      />
      {slots.length === 0 && (
        <Text c="dimmed" size="xs">
          {props.emptyHint ?? "No arguments yet."}
        </Text>
      )}
      {slots.map((slot) => (
        <ArgumentRow
          key={slot.key}
          keyLabel={slot.key}
          option={catalog.knownArgByPresetKey.get(slot.key) ?? null}
          value={slot.value}
          scope="preset"
          isDefault={slot.isDefault}
          active={slot.active}
          presetKey={slot.key}
          onToggle={(active) => setActive(slot.key, slot.value, active)}
          onRemove={() => remove(slot.key)}
          onValueChange={(value) => setValue(slot.key, value)}
        />
      ))}
    </Stack>
  );
}
