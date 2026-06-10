import { Stack, Text } from "@mantine/core";

import { pathBaseName } from "../utils/models";
import { TouchSelect } from "./TouchCombobox";

export function MmprojSelect(props: {
  mmprojPaths: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const value = props.value?.trim() ? props.value : null;
  if (props.mmprojPaths.length === 0 && !value) {
    return null;
  }
  const options = props.mmprojPaths.map((path) => ({
    value: path,
    label: pathBaseName(path),
  }));
  if (value && !options.some((option) => option.value === value)) {
    options.push({ value, label: `${pathBaseName(value)} · custom path` });
  }
  return (
    <Stack gap={2}>
      <TouchSelect
        label="mmproj"
        placeholder="No multimodal projector"
        clearable
        searchable
        value={value}
        onChange={props.onChange}
        data={options}
      />
      {value && (
        <Text c="dimmed" size="xs" className="text-wrap">
          {value}
        </Text>
      )}
    </Stack>
  );
}
